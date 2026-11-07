# Rolling torrent cache

Movie size is independent of the disk cache budget. The existing Auto/manual
setting controls bounded storage, not the maximum logical file length.

## Storage and scheduling

- The app stores numbered torrent pieces, not a sparse or full-size movie file.
- Scheduling follows each active reader's position with bounded read-ahead, up
  to 32 MiB per stream and reduced for small budgets. Natural whole-file background
  downloading is disabled for rolling storage.
- Before scheduling a piece, storage reserves a slot. Current reader pieces and
  in-flight/verifying downloads are protected. If every slot is protected, the
  scheduler applies backpressure instead of allocating beyond the budget.
- Evicting a piece also clears its verified HAVE bit, chunk map and per-file
  progress under the torrent state lock. Seeking back schedules a fresh download
  and hash verification. A raced cache miss retries rather than returning zeros.
- Per-piece filesystem overhead and 8 MiB of bookkeeping headroom are reserved.
  Writes also check the 384 MiB system free-space reserve.
- File descriptors are opened for each operation, so a torrent with many small
  pieces cannot consume a descriptor for every cached piece.
- Streaming responses use `Cache-Control: no-store`, preventing a second browser
  disk cache from retaining the movie outside the engine's storage budget.
- Cache metadata is retained; disposable piece data is reinitialised safely on
  engine restart. Preferences and installed addons are unaffected.
- Rolling torrents do not advertise or upload evictable pieces. This avoids
  claiming pieces that may already have been discarded.

Changes to the budget apply on subsequent stream requests. Shrinking a budget
that would invalidate an active reservation is refused; leave playback first.
The cache must accommodate at least four torrent pieces. Unsupported extremely
small/non-block-aligned piece sizes are rejected explicitly. Metadata is capped
at 2 MiB. These are storage/protocol bounds, not a movie-length limit.

## Upstream changes

Cargo patches librqbit 8.1.1 to the vendored copy. Upstream source commit and
licensing are in THIRD_PARTY_NOTICES.md. Modifications are limited to:

- `src/storage/mod.rs`: optional rolling reservation/read-ahead hooks and CacheMiss.
- `src/chunk_tracker.rs`: coherent eviction bookkeeping.
- `src/torrent_state/live/mod.rs`: stream-only scheduling, reservation before
  downloading, verification protection and no advertisement of evictable data.
- `src/torrent_state/streaming.rs`: budget-aware read-ahead, scheduler wakeups,
  current-piece protection and safe read retries.

Default storage implementations retain their original whole-file behaviour.

## Deterministic verification

The test fixture is a synthetic torrent with logical length 4 GiB + 12,345 bytes,
served by a real local BitTorrent peer. Only selected ranges are transferred.
It requires no public swarm, media account or copyrighted movie.

With an 8 MiB budget, checks cover sequential streaming beyond multiple cache
turnovers, offsets above 3 GiB and at the file end, backward re-download of an
evicted piece, concurrent readers, byte correctness, bounded disk allocation,
restart recovery, and a multi-file layout whose boundary splits a piece.
The test passed on the host and as a compiled ARMv7 executable on the Fire Stick.
An HTTP adapter test also accepted a suffix range above 4 GiB with a 512 MiB
budget and verified the no-store header. Eight Rust tests pass in total.
The installed rolling engine decoded the licensed 1080p Big Buck Bunny clip
(1920×1080, 634.6 seconds, 101 decoded frames observed during the smoke check).
Public-swarm startup was slow and needed a warm retry; this is not an endurance
or bandwidth benchmark.
The final installed package reports `storageMode: rolling`, retains the existing
Auto preference, displays the rolling-cache explanation in Settings, and returns
HTTP 206 with `Cache-Control: no-store` for a ranged stream HEAD request.

Run host checks with `cargo test --locked --lib` in `torrent-probe`.
The diagnostic executable is opt-in and excluded from normal app builds:

```bash
bash build-armv7.sh --selftest
```

It uses a unique disposable test directory and removes it on success. On ARM it
uses `/data` rather than RAM-backed `/tmp`. Keep the diagnostic executable out of
production packages. Actual video decoding still depends on the device codecs
and the selected stream; the synthetic test establishes storage/seek correctness.
