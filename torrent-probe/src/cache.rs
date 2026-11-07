//! App-owned, per-info-hash disk cache. Planning never deletes active entries.
use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
pub const LIMIT: u64 = 1536 * 1024 * 1024;
pub const DISK_RESERVE: u64 = 384 * 1024 * 1024;
pub const OVERHEAD: u64 = 8 * 1024 * 1024;
pub struct Cache {
    pub root: PathBuf,
    pub limit: u64,
}
#[derive(Clone)]
pub struct Entry {
    pub hash: String,
    pub reserved: u64,
    pub disk: u64,
    pub touched: u64,
}
pub fn valid_hash(hash: &str) -> bool {
    hash.len() == 40 && hash.bytes().all(|c| c.is_ascii_hexdigit())
}
fn disk_bytes(path: &Path) -> io::Result<u64> {
    use std::os::unix::fs::MetadataExt;
    let m = fs::symlink_metadata(path)?;
    if m.file_type().is_symlink() {
        return Ok(0);
    }
    if m.is_dir() {
        fs::read_dir(path)?.try_fold(0u64, |sum, e| {
            Ok(sum.saturating_add(disk_bytes(&e?.path())?))
        })
    } else {
        Ok(m.blocks().saturating_mul(512))
    }
}
impl Cache {
    pub fn new(root: PathBuf, limit: u64) -> io::Result<Self> {
        fs::create_dir_all(&root)?;
        if fs::symlink_metadata(&root)?.file_type().is_symlink() {
            return Err(io::Error::other("Cache root cannot be a symlink"));
        }
        let root = root.canonicalize()?;
        let this = Self { root, limit };
        // The whole root is reserved for disposable downloads. Migrate old name-based caches.
        for e in fs::read_dir(&this.root)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().to_string();
            if !valid_hash(&name) || e.file_type()?.is_symlink() {
                this.remove_child(&name)?;
            }
        }
        Ok(this)
    }
    fn remove_child(&self, name: &str) -> io::Result<()> {
        let path = self.root.join(name);
        if path.parent() != Some(self.root.as_path()) || name.contains(['/', '\\']) {
            return Err(io::Error::other("Invalid cache child"));
        }
        let m = fs::symlink_metadata(&path)?;
        if m.is_dir() && !m.file_type().is_symlink() {
            fs::remove_dir_all(path)
        } else {
            fs::remove_file(path)
        }
    }
    pub fn path(&self, hash: &str) -> io::Result<PathBuf> {
        if !valid_hash(hash) {
            return Err(io::Error::other("Invalid cache hash"));
        }
        let p = self.root.join(hash.to_ascii_lowercase());
        if p.exists() && fs::symlink_metadata(&p)?.file_type().is_symlink() {
            return Err(io::Error::other("Cache entry cannot be a symlink"));
        }
        fs::create_dir_all(&p)?;
        Ok(p)
    }
    pub fn entries(&self) -> io::Result<Vec<Entry>> {
        fs::read_dir(&self.root)?
            .map(|e| {
                let e = e?;
                let hash = e.file_name().to_string_lossy().to_string();
                if !valid_hash(&hash) || !e.file_type()?.is_dir() || e.file_type()?.is_symlink() {
                    return Err(io::Error::other("Unexpected cache entry"));
                }
                let reserved = fs::read_to_string(e.path().join(".reserved"))
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let touched = fs::metadata(e.path().join(".used"))
                    .and_then(|m| m.modified())
                    .unwrap_or(UNIX_EPOCH)
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                Ok(Entry {
                    hash,
                    reserved,
                    disk: disk_bytes(&e.path())?,
                    touched,
                })
            })
            .collect()
    }
    pub fn touch(&self, hash: &str, reserved: u64) -> io::Result<()> {
        let p = self.path(hash)?;
        fs::write(p.join(".reserved"), reserved.to_string())?;
        fs::write(p.join(".used"), format!("{:?}", SystemTime::now()))
    }
    pub fn remove(&self, hash: &str) -> io::Result<()> {
        if !valid_hash(hash) {
            return Err(io::Error::other("Invalid cache hash"));
        }
        self.remove_child(hash)
    }
    pub fn plan(
        &self,
        incoming: &str,
        size: u64,
        free: u64,
        protected: &HashSet<String>,
    ) -> io::Result<Vec<String>> {
        if size > self.limit {
            return Err(io::Error::other(
                "Selected file exceeds the 1.5 GiB cache limit; choose a smaller stream",
            ));
        }
        let entries = self.entries()?;
        let current = entries
            .iter()
            .find(|e| e.hash == incoming)
            .map(|e| e.disk)
            .unwrap_or(0);
        let needed = size.saturating_sub(current);
        let mut allocated = entries
            .iter()
            .filter(|e| e.hash != incoming)
            .fold(size, |n, e| n.saturating_add(e.reserved.max(e.disk)));
        let mut reclaimed = 0u64;
        let mut candidates: Vec<_> = entries
            .into_iter()
            .filter(|e| e.hash != incoming && !protected.contains(&e.hash))
            .collect();
        candidates.sort_by_key(|e| e.touched);
        let mut victims = Vec::new();
        for e in candidates {
            if allocated <= self.limit
                && free.saturating_add(reclaimed) >= needed.saturating_add(DISK_RESERVE)
            {
                break;
            }
            allocated = allocated.saturating_sub(e.reserved.max(e.disk));
            reclaimed = reclaimed.saturating_add(e.disk);
            victims.push(e.hash);
        }
        if allocated > self.limit
            || free.saturating_add(reclaimed) < needed.saturating_add(DISK_RESERVE)
        {
            return Err(io::Error::other(
                "Not enough cache space without removing an active stream",
            ));
        }
        Ok(victims)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn cache() -> Cache {
        Cache::new(
            std::env::temp_dir().join(format!(
                "vega-cache-test-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            )),
            100,
        )
        .unwrap()
    }
    #[test]
    fn evicts_idle_and_protects_active() {
        let c = cache();
        let a = "a".repeat(40);
        let b = "b".repeat(40);
        c.touch(&a, 80).unwrap();
        assert_eq!(
            c.plan(&b, 80, u64::MAX, &HashSet::new()).unwrap(),
            vec![a.clone()]
        );
        assert!(c
            .plan(&b, 80, u64::MAX, &HashSet::from([a.clone()]))
            .is_err());
        assert!(c.path("../outside").is_err());
        assert!(c.plan(&b, 101, u64::MAX, &HashSet::new()).is_err());
        fs::remove_dir_all(&c.root).unwrap();
    }
    #[test]
    fn insufficient_disk_and_symlink_safety() {
        let c = cache();
        let a = "c".repeat(40);
        assert!(c.plan(&a, 10, 0, &HashSet::new()).is_err());
        let outside = c.root.with_extension("outside");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("keep"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, c.root.join(&a)).unwrap();
        assert!(c.path(&a).is_err());
        c.remove(&a).unwrap();
        assert!(outside.join("keep").exists());
        fs::remove_dir_all(c.root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
