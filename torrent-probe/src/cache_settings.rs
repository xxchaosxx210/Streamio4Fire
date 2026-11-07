//! Persistent app preferences, stored beside (not inside) disposable downloads.
use crate::cache::{DISK_RESERVE, LIMIT};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::Path,
};

pub const MIN_LIMIT: u64 = 512 * 1024 * 1024;
pub const MAX_LIMIT: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Auto,
    Manual,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub mode: Mode,
    pub limit_bytes: Option<u64>,
}
impl Preferences {
    pub fn validate(self) -> io::Result<Self> {
        match (self.mode, self.limit_bytes) {
            (Mode::Auto, None) => Ok(self),
            (Mode::Manual, Some(n)) if (MIN_LIMIT..=MAX_LIMIT).contains(&n) => Ok(self),
            _ => Err(io::Error::other(
                "Choose Auto, or a cache size between 0.5 and 8 GiB",
            )),
        }
    }
    pub fn load(path: &Path) -> io::Result<Self> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice::<Self>(&bytes)?.validate(),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e),
        }
    }
    pub fn save(self, path: &Path) -> io::Result<()> {
        use std::os::unix::fs::OpenOptionsExt;
        self.validate()?;
        let temporary = path.with_extension("json.tmp");
        // Recover a temporary file left by an interrupted previous save. Callers
        // serialize writes with the cache gate; unlinking never follows symlinks.
        match fs::remove_file(&temporary) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temporary)?;
        let result = (|| {
            file.write_all(&serde_json::to_vec(&self)?)?;
            file.sync_all()?;
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result
    }
    pub fn effective(self, maximum: u64) -> u64 {
        match self.mode {
            Mode::Auto => LIMIT.min(maximum),
            Mode::Manual => self.limit_bytes.unwrap_or(LIMIT).min(maximum),
        }
    }
}
pub fn maximum(disk_bytes: u64, free_bytes: u64) -> u64 {
    disk_bytes
        .saturating_add(free_bytes)
        .saturating_sub(DISK_RESERVE)
        .min(MAX_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn respects_storage_reserve_and_requested_budget() {
        assert_eq!(maximum(0, DISK_RESERVE - 1), 0);
        assert_eq!(maximum(1024, DISK_RESERVE + 2048), 3072);
        assert_eq!(Preferences::default().effective(MAX_LIMIT), LIMIT);
        let manual = Preferences {
            mode: Mode::Manual,
            limit_bytes: Some(2 * 1024 * 1024 * 1024),
        };
        assert_eq!(manual.effective(MIN_LIMIT), MIN_LIMIT);
        assert_eq!(manual.effective(MAX_LIMIT), 2 * 1024 * 1024 * 1024);
        assert!(Preferences {
            mode: Mode::Auto,
            limit_bytes: Some(MIN_LIMIT)
        }
        .validate()
        .is_err());
        assert!(Preferences {
            mode: Mode::Manual,
            limit_bytes: Some(MAX_LIMIT + 1)
        }
        .validate()
        .is_err());
        assert!(Preferences {
            mode: Mode::Manual,
            limit_bytes: None
        }
        .validate()
        .is_err());
    }
    #[test]
    fn preferences_survive_download_cleanup() {
        let root = std::env::temp_dir().join(format!("streamio-settings-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let cache = crate::cache::Cache::new(root.join("downloads"), LIMIT).unwrap();
        let path = cache.root.with_extension("settings.json");
        let preference = Preferences {
            mode: Mode::Manual,
            limit_bytes: Some(MIN_LIMIT),
        };
        fs::write(path.with_extension("json.tmp"), "interrupted save").unwrap();
        preference.save(&path).unwrap();
        drop(crate::cache::Cache::new(cache.root.clone(), LIMIT).unwrap());
        assert_eq!(Preferences::load(&path).unwrap(), preference);
        assert!(!path.with_extension("json.tmp").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
