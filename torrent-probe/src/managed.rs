use crate::cache::{Cache, OVERHEAD};
use crate::cache_settings::{self, Preferences};
use librqbit::{
    api::{Api, TorrentIdOrHash},
    Session,
};
use std::{
    collections::{HashMap, HashSet},
    ffi::CString,
    io,
    ops::Deref,
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
pub struct Managed {
    api: Api,
    pub cache: Cache,
    pub gate: tokio::sync::Mutex<()>,
    selected: Mutex<Option<String>>,
    leases: Mutex<HashMap<String, Arc<AtomicUsize>>>,
    error: Mutex<Option<String>>,
    requested: Mutex<Option<String>>,
    metadata: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    preferences: Mutex<Preferences>,
}

#[cfg(test)]
mod settings_tests {
    use super::*;
    use crate::{
        cache::LIMIT,
        cache_settings::{Mode, MIN_LIMIT},
    };
    #[tokio::test]
    async fn resizing_protects_active_downloads_then_reclaims_idle_data() {
        let root = std::env::temp_dir().join(format!("streamio-resize-{}", std::process::id()));
        let cache = Cache::new(root.join("downloads"), LIMIT).unwrap();
        let hash = "d".repeat(40);
        cache.touch(&hash, MIN_LIMIT * 2).unwrap();
        let session = Session::new_with_opts(
            cache.root.clone(),
            librqbit::SessionOptions {
                disable_dht: true,
                disable_dht_persistence: true,
                enable_upnp_port_forwarding: false,
                listen_port_range: None,
                ..Default::default()
            },
        )
        .await
        .unwrap();
        let managed = Managed::new(session.clone(), cache);
        managed.begin_selection(&hash);
        let small = Preferences {
            mode: Mode::Manual,
            limit_bytes: Some(MIN_LIMIT),
        };
        assert!(managed.configure(small).await.is_err());
        assert_eq!(*managed.preferences.lock().unwrap(), Preferences::default());
        assert_eq!(managed.cache.entries().unwrap().len(), 1);
        managed.release().await;
        managed.configure(small).await.unwrap();
        assert!(managed.cache.entries().unwrap().is_empty());
        assert_eq!(
            Preferences::load(&managed.cache.root.with_extension("settings.json")).unwrap(),
            small
        );
        assert_eq!(managed.status().unwrap()["limitBytes"], MIN_LIMIT);
        session.stop().await;
        std::fs::remove_dir_all(root).unwrap();
    }
}
impl Deref for Managed {
    type Target = Api;
    fn deref(&self) -> &Api {
        &self.api
    }
}
pub struct Lease(Arc<AtomicUsize>);
impl Drop for Lease {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
pub struct Guarded<S> {
    pub inner: S,
    pub _lease: Lease,
}
impl<S: futures_core::Stream + Unpin> futures_core::Stream for Guarded<S> {
    type Item = S::Item;
    fn poll_next(
        mut self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<Self::Item>> {
        std::pin::Pin::new(&mut self.inner).poll_next(cx)
    }
}
pub fn free_space(root: &Path) -> io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let path = CString::new(root.as_os_str().as_bytes())?;
    let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let stat = unsafe { stat.assume_init() };
    Ok((stat.f_bavail as u64).saturating_mul(stat.f_frsize as u64))
}
impl Managed {
    pub fn new(session: Arc<Session>, cache: Cache) -> Arc<Self> {
        let preferences =
            Preferences::load(&cache.root.with_extension("settings.json")).unwrap_or_default();
        Arc::new(Self {
            api: Api::new(session, None, None),
            cache,
            gate: tokio::sync::Mutex::new(()),
            selected: Mutex::new(None),
            leases: Mutex::new(HashMap::new()),
            error: Mutex::new(None),
            requested: Mutex::new(None),
            metadata: Mutex::new(HashMap::new()),
            preferences: Mutex::new(preferences),
        })
    }
    pub fn set_error(&self, error: String) {
        *self.error.lock().unwrap() = Some(error);
    }
    pub fn begin_selection(&self, hash: &str) {
        let hash = hash.to_ascii_lowercase();
        let changed = self.requested.lock().unwrap().as_ref() != Some(&hash);
        if changed {
            *self.selected.lock().unwrap() = None;
            *self.error.lock().unwrap() = None;
        }
        *self.requested.lock().unwrap() = Some(hash);
    }
    pub fn error_for(&self, hash: &str, message: String) {
        if self.requested.lock().unwrap().as_deref() == Some(hash) {
            self.set_error(message);
        }
    }
    pub fn metadata_lock(&self, hash: &str) -> Arc<tokio::sync::Mutex<()>> {
        self.metadata
            .lock()
            .unwrap()
            .entry(hash.to_ascii_lowercase())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
            .clone()
    }
    fn protected(&self, selected: bool) -> HashSet<String> {
        let mut result: HashSet<_> = self
            .leases
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, v)| v.load(Ordering::SeqCst) > 0)
            .map(|(k, _)| k.clone())
            .collect();
        if selected {
            if let Some(hash) = self.selected.lock().unwrap().clone() {
                result.insert(hash);
            }
            if let Some(hash) = self.requested.lock().unwrap().clone() {
                result.insert(hash);
            }
        }
        result
    }
    async fn evict(&self, hash: &str) -> anyhow::Result<()> {
        let id = TorrentIdOrHash::parse(hash)?;
        if self.api.api_torrent_details(id).is_ok() {
            self.api.api_torrent_action_forget(id).await?;
        }
        self.cache.remove(hash)?;
        self.leases.lock().unwrap().remove(hash);
        Ok(())
    }
    pub async fn prepare(&self, hash: &str, size: u64) -> anyhow::Result<Lease> {
        let hash = hash.to_ascii_lowercase();
        let _gate = self.gate.lock().await;
        let reserve = size
            .checked_add(OVERHEAD)
            .ok_or_else(|| anyhow::anyhow!("Invalid file size"))?;
        let budget = Cache {
            root: self.cache.root.clone(),
            limit: self.limit()?,
        };
        let victims = budget.plan(
            &hash,
            reserve,
            free_space(&self.cache.root)?,
            &self.protected(false),
        )?;
        for victim in victims {
            self.evict(&victim).await?;
        }
        self.cache.touch(&hash, reserve)?;
        *self.selected.lock().unwrap() = Some(hash.clone());
        *self.error.lock().unwrap() = None;
        let counter = self
            .leases
            .lock()
            .unwrap()
            .entry(hash)
            .or_insert_with(|| Arc::new(AtomicUsize::new(0)))
            .clone();
        counter.fetch_add(1, Ordering::SeqCst);
        Ok(Lease(counter))
    }
    pub async fn release(&self) {
        let _gate = self.gate.lock().await;
        *self.selected.lock().unwrap() = None;
        *self.requested.lock().unwrap() = None;
        *self.error.lock().unwrap() = None;
    }
    pub async fn clear_idle(&self) -> anyhow::Result<usize> {
        let _gate = self.gate.lock().await;
        let protected = self.protected(true);
        let mut count = 0;
        for entry in self.cache.entries()? {
            if !protected.contains(&entry.hash) {
                self.evict(&entry.hash).await?;
                count += 1;
            }
        }
        Ok(count)
    }
    pub fn status(&self) -> anyhow::Result<serde_json::Value> {
        let entries = self.cache.entries()?;
        let disk = entries.iter().fold(0u64, |n, e| n.saturating_add(e.disk));
        let free = free_space(&self.cache.root)?;
        let preferences = *self.preferences.lock().unwrap();
        let maximum = cache_settings::maximum(disk, free);
        Ok(
            serde_json::json!({"limitBytes":preferences.effective(maximum),"reserveBytes":crate::cache::DISK_RESERVE,
            "preferences":preferences,"maxLimitBytes":maximum,"minLimitBytes":cache_settings::MIN_LIMIT,"storageMode":"whole-file",
            "reservedBytes":entries.iter().fold(0u64,|n,e|n.saturating_add(e.reserved.max(e.disk))),
            "diskBytes":disk,"entries":entries.len(),
            "activeEntries":self.protected(true).len(),"freeBytes":free,"error":self.error.lock().unwrap().clone()}),
        )
    }
    pub fn limit(&self) -> anyhow::Result<u64> {
        let disk = self
            .cache
            .entries()?
            .iter()
            .fold(0u64, |n, e| n.saturating_add(e.disk));
        Ok(self
            .preferences
            .lock()
            .unwrap()
            .effective(cache_settings::maximum(disk, free_space(&self.cache.root)?)))
    }
    pub async fn configure(&self, preferences: Preferences) -> anyhow::Result<()> {
        preferences.validate()?;
        let _gate = self.gate.lock().await;
        let disk = self
            .cache
            .entries()?
            .iter()
            .fold(0u64, |n, e| n.saturating_add(e.disk));
        let free = free_space(&self.cache.root)?;
        let maximum = cache_settings::maximum(disk, free);
        if preferences.limit_bytes.is_some_and(|n| n > maximum) {
            anyhow::bail!(
                "That cache size would leave too little system storage; choose a smaller size"
            );
        }
        let budget = Cache {
            root: self.cache.root.clone(),
            limit: preferences.effective(maximum),
        };
        let victims = budget.plan("", 0, free, &self.protected(true))?;
        for hash in victims {
            self.evict(&hash).await?;
        }
        preferences.save(&self.cache.root.with_extension("settings.json"))?;
        *self.preferences.lock().unwrap() = preferences;
        Ok(())
    }
    pub async fn pause_idle(&self) {
        let _gate = self.gate.lock().await;
        let protected = self.protected(true);
        if let Ok(list) = serde_json::to_value(self.api.api_torrent_list()) {
            for item in list["torrents"].as_array().into_iter().flatten() {
                if let Some(hash) = item["info_hash"].as_str() {
                    if !protected.contains(hash) {
                        if let Ok(id) = TorrentIdOrHash::parse(hash) {
                            if self
                                .api
                                .api_stats_v1(id)
                                .is_ok_and(|s| s.state.to_string() == "live")
                            {
                                let _ = self.api.api_torrent_action_pause(id).await;
                            }
                        }
                    }
                }
            }
        }
    }
}
