//! Bounded, disposable torrent-piece storage. No logical movie files are allocated.
use anyhow::{Context, Result};
use librqbit::{
    storage::{CacheMiss, StorageFactory, StorageFactoryExt, TorrentStorage},
    ManagedTorrentShared, TorrentMetadata,
};
use librqbit_core::lengths::ValidPieceIndex;
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    os::unix::fs::FileExt,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};

pub struct Control {
    pub capacity: AtomicU64,
    pub evictions: AtomicU64,
}
impl Control {
    pub fn new(capacity: u64) -> Arc<Self> {
        Arc::new(Self {
            capacity: AtomicU64::new(capacity),
            evictions: AtomicU64::new(0),
        })
    }
}
#[derive(Clone)]
pub struct Factory {
    pub root: PathBuf,
    pub control: Arc<Control>,
}
impl StorageFactory for Factory {
    type Storage = Rolling;
    fn create(&self, _: &ManagedTorrentShared, metadata: &TorrentMetadata) -> Result<Rolling> {
        // This directory is app-owned, scoped to a validated torrent hash, and
        // creation precedes any live downloads. Retain metadata and quota markers.
        for entry in fs::read_dir(&self.root)? {
            let entry = entry?;
            if [".torrent", ".reserved", ".used"]
                .iter()
                .any(|n| entry.file_name() == *n)
            {
                continue;
            }
            if entry.file_type()?.is_dir() {
                fs::remove_dir_all(entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        }
        Rolling::new(self.root.join("pieces"), metadata, self.control.clone())
    }
    fn clone_box(&self) -> librqbit::storage::BoxStorageFactory {
        self.clone().boxed()
    }
}
struct Slot {
    used: u64,
}
#[derive(Default)]
struct State {
    slots: HashMap<u32, Slot>,
    tick: u64,
}
#[derive(Clone)]
pub struct Rolling {
    root: PathBuf,
    piece_len: u64,
    total_len: u64,
    files: Arc<Vec<(u64, u64)>>,
    state: Arc<Mutex<State>>,
    control: Arc<Control>,
}
impl Rolling {
    fn new(root: PathBuf, metadata: &TorrentMetadata, control: Arc<Control>) -> Result<Self> {
        let piece_len = metadata.lengths.default_piece_length() as u64;
        anyhow::ensure!(
            piece_len >= 16384 && piece_len % 4096 == 0,
            "Unsupported torrent piece size for bounded storage"
        );
        anyhow::ensure!(
            control.capacity.load(Ordering::Relaxed) / piece_len >= 4,
            "Torrent pieces are too large for this cache budget; increase the cache size"
        );
        fs::create_dir_all(&root)?;
        Ok(Self {
            root,
            piece_len,
            total_len: metadata.lengths.total_length(),
            files: Arc::new(
                metadata
                    .file_infos
                    .iter()
                    .map(|f| (f.offset_in_torrent, f.len))
                    .collect(),
            ),
            state: Arc::new(Mutex::new(State::default())),
            control,
        })
    }
    fn absolute(&self, file: usize, offset: u64, len: usize) -> Result<u64> {
        let (start, size) = *self.files.get(file).context("Invalid torrent file index")?;
        anyhow::ensure!(
            offset
                .checked_add(len as u64)
                .is_some_and(|end| end <= size),
            "Read/write outside torrent file"
        );
        Ok(start + offset)
    }
    fn visit(
        &self,
        absolute: u64,
        len: usize,
        mut f: impl FnMut(&File, u64, usize, usize) -> Result<()>,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let mut consumed = 0;
        while consumed < len {
            let at = absolute + consumed as u64;
            let piece = u32::try_from(at / self.piece_len)?;
            let offset = at % self.piece_len;
            let amount = (len - consumed).min((self.piece_len - offset) as usize);
            state.tick += 1;
            let tick = state.tick;
            let slot = state.slots.get_mut(&piece).ok_or(CacheMiss)?;
            slot.used = tick;
            // Keep descriptors bounded independently of the number of cached pieces.
            let file = File::options()
                .read(true)
                .write(true)
                .open(self.root.join(format!("{piece}.bin")))
                .map_err(|e| {
                    if e.kind() == std::io::ErrorKind::NotFound {
                        anyhow::Error::new(CacheMiss)
                    } else {
                        e.into()
                    }
                })?;
            f(&file, offset, consumed, amount)?;
            consumed += amount;
        }
        Ok(())
    }
}
impl TorrentStorage for Rolling {
    fn init(&mut self, _: &ManagedTorrentShared, _: &TorrentMetadata) -> Result<()> {
        Ok(())
    }
    fn rolling_lookahead_bytes(&self) -> Option<u64> {
        Some(
            (self.control.capacity.load(Ordering::Relaxed) / 8)
                .max(self.piece_len)
                .min(32 * 1024 * 1024),
        )
    }
    fn reserve_piece(
        &self,
        piece: ValidPieceIndex,
        protected: &[ValidPieceIndex],
    ) -> Result<Option<Vec<ValidPieceIndex>>> {
        let mut state = self.state.lock().unwrap();
        if state.slots.contains_key(&piece.get()) {
            return Ok(Some(Vec::new()));
        }
        // Allow filesystem directory/inode overhead rather than counting only payload.
        let capacity = self.control.capacity.load(Ordering::Relaxed) / (self.piece_len + 4096);
        let protected: HashSet<_> = protected.iter().map(|p| p.get()).collect();
        if capacity == 0 {
            return Ok(None);
        };
        let needed = (state.slots.len() as u64 + 1).saturating_sub(capacity) as usize;
        let mut candidates: Vec<_> = state
            .slots
            .iter()
            .filter(|(id, _)| !protected.contains(id))
            .map(|(id, s)| (*id, s.used))
            .collect();
        candidates.sort_by_key(|(_, used)| *used);
        if candidates.len() < needed {
            return Ok(None);
        }
        let mut evicted = Vec::new();
        for (victim, _) in candidates.into_iter().take(needed) {
            // Unlink before removing the slot; failed deletion never frees quota.
            fs::remove_file(self.root.join(format!("{victim}.bin")))?;
            state.slots.remove(&victim);
            self.control.evictions.fetch_add(1, Ordering::Relaxed);
            // This is a previously validated index supplied by the scheduler.
            evicted.push(
                librqbit_core::lengths::Lengths::new(self.total_len, self.piece_len as u32)?
                    .validate_piece_index(victim)
                    .context("Invalid cached piece")?,
            );
        }
        // Reserve physical disk only as chunks arrive, bounded by this slot count.
        drop(
            File::options()
                .read(true)
                .write(true)
                .create_new(true)
                .open(self.root.join(format!("{}.bin", piece.get())))?,
        );
        state.tick += 1;
        let used = state.tick;
        state.slots.insert(piece.get(), Slot { used });
        Ok(Some(evicted))
    }
    fn pread_exact(&self, file: usize, offset: u64, buf: &mut [u8]) -> Result<()> {
        self.visit(
            self.absolute(file, offset, buf.len())?,
            buf.len(),
            |slot, at, start, amount| {
                slot.read_exact_at(&mut buf[start..start + amount], at)?;
                Ok(())
            },
        )
    }
    fn pwrite_all(&self, file: usize, offset: u64, buf: &[u8]) -> Result<()> {
        anyhow::ensure!(
            crate::managed::free_space(&self.root)?
                >= crate::cache::DISK_RESERVE.saturating_add(buf.len() as u64),
            "System storage reserve reached; clear unused cache or free device storage"
        );
        self.visit(
            self.absolute(file, offset, buf.len())?,
            buf.len(),
            |slot, at, start, amount| {
                slot.write_all_at(&buf[start..start + amount], at)?;
                Ok(())
            },
        )
    }
    fn ensure_file_length(&self, _: usize, _: u64) -> Result<()> {
        Ok(())
    }
    fn remove_file(&self, _: usize, _: &Path) -> Result<()> {
        Ok(())
    }
    fn remove_directory_if_empty(&self, _: &Path) -> Result<()> {
        Ok(())
    }
    fn take(&self) -> Result<Box<dyn TorrentStorage>> {
        Ok(Box::new(self.clone()))
    }
}
