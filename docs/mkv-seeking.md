# MKV seeking on Vega

The Stick's native URL-mode player can display MKV while ignoring seeks.
Amazon identifies a Matroska HTTP seeking limitation in its platform player:
https://community.amazondeveloper.com/t/native-kepler-player-controls-not-working-for-mp4-files-with-mkv-container/28603

Streamio4Fire works around it for MKV torrents served by its own engine. Initial
playback uses the native player. Seeking or resuming switches that player to
MediaSource, fed with bounded fragmented-MP4 sections prepared on the Stick.
The laptop, an external streaming server and an OS update are not required.

## Data and timing

- The Rust endpoint accepts only a validated info hash, file index and finite
  start time, and opens that app-managed torrent. FFmpeg receives seek/read
  callbacks into the rolling-cache reader rather than reopening HTTP ranges.
  The cache lease remains held for the whole operation.
- FFmpeg 7.1.3's format/codec/utility libraries are linked into the native module.
  No subprocess, decoder or encoder is used. Video and audio packets are copied.
- Sections target 24 seconds or 8 MiB of media, ending before the next keyframe.
  Retained input packets and output are each capped at 16 MiB. MP4 sections
  are kept in memory; they do not create another full movie on disk.
- Matroska can report presentation timestamps as decode timestamps. Reordered
  frames then fail MP4's monotonic decode-clock requirement. The native module
  validates decode timestamps and reconstructs invalid ones from actual packet
  presentation cadence. Presentation timestamps and relative audio timing remain
  unchanged. This does not assume a constant frame rate.
- Where negative decode timestamps need headroom, all tracks receive the same
  transport offset. The response reports that offset; MediaSource reverses it.
  The next keyframe's original time is also returned for continuous prefetching.
- The controller prefetches before the current section runs out and removes old
  sections behind playback. Existing rolling torrent storage still enforces the
  user's disk-cache budget, independently of the movie's total size.
- One native preparation runs at a time. Cancellation and a 75-second deadline
  interrupt input work. A cold-reader failure is retried once inside that same
  deadline; allocation/size failures are not retried. A failed part produces a
  source-choice message.
  Reader waits check cancellation every 250 ms and have a 20-second read timeout.

The current codec-description bridge handles H.264/HEVC with AAC, AC-3 or E-AC-3,
subject to the device's native MediaSource support. It does not add software
decoding, subtitle support or transcoding. Direct third-party MKV URLs are not
proxied through this endpoint. They retain the existing native URL-mode path.

## Validation — 8 November 2026

- The original failure was reproduced without torrents: HTTP MP4 sought to 45
  and 10 seconds, while an equivalent HTTP MKV ignored both requests.
- A remuxed section from the actual HEVC/E-AC-3 MKV played through MediaSource,
  with real 35 → 45 → 35 second clock changes and advancing playback afterward.
- The app resumed the same 2.37 GB MKV at a saved position around 188 seconds.
  Forward and backward actions loaded sections containing their requested times;
  video was visually inspected and successive sections were prefetched.
- The user confirmed the physical remote's +10, −10 and Play/Pause controls work,
  with audio in sync. This is separate from synthetic key injection.
- After removing diagnostics, direct-reader cold startup resumed at 338.888
  seconds and continued across sections. A paused device test showed
  7:37 → 7:47 → 7:37, with the picture changing at each seek. Back restored the
  source route and saved position with zero active cache leases.
- Host regression checks use the same native implementation and generated
  H.264 B-frame/AAC media. They check original picture/audio presentation times,
  strictly increasing decode times, three seek positions, full decoding and
  cancellation. Actual HEVC/E-AC-3 sections were also decode-checked privately.
- Ten Rust tests, 30 bridge/remote/URL-boundary checks, seven addon-link cases and
  the wrapper TypeScript check pass. The production ARM FFmpeg build is pinned
  and checksum-verified by `scripts/build-remux.sh`.

Extra seek traces and diagnostic files are temporary and are removed from the
installed build after validation. No diagnostic clip or configured source is
included in this repository or the normal application.

## Reproducing the native regression

A longer playback check found a repeatable resume failure at 483.517 seconds in
a high-bitrate source: its complete keyframe section required about 13 MiB,
exceeding the former 12 MiB retained-input cap. The input cap now matches the
existing 16 MiB output cap; the 8 MiB soft target, packet-count limit and deadlines
remain. The generated high-bitrate GOP regression fails with the old bound and
passes with the new one, verifies decoded output/timestamps, and rejects a GOP
above the hard budget. The exact failing section also succeeded on the Stick and
normal source selection resumed beyond it after installing this change.

`scripts/test-remux.sh` needs a configured host FFmpeg 7.1.3 library build in
`STREAMIO_HOST_FFMPEG_ROOT`, a C++ compiler, and a full host `ffmpeg` executable
with libx264/AAC support (override its path with `FFMPEG`). The native build uses
the Vega ARM toolchain instead; see `scripts/build-remux.sh`.
