# Third-party notices

- **Stremio Web**, Stremio contributors:
  https://github.com/Stremio/stremio-web
  Commit `f70766cf76dc993689d8dac2f5598d1d24a80dc6`.
  GNU GPL version 2; the upstream licence is copied to
  `LICENSES/Stremio-Web-GPL-2.0.md`. The build obtains the source separately.
  `torrent-probe/frontend-controls/keyboard.ts` and its patch derive from this
  project and retain that licence. Changes add Fire TV Back and media-key mapping.
- **rqbit / librqbit 8.1.1**, rqbit contributors:
  https://github.com/ikatson/rqbit — Apache-2.0. The crates.io 8.1.1 source is
  vendored at `torrent-probe/vendor/librqbit`, with its Apache licence. Upstream
  source commit: `00b97485160ff5b5aa2b379ea0815d568ec665f0`, `crates/librqbit`.
  Streamio4Fire changes add opt-in rolling storage hooks, stream-window scheduling,
  safe piece invalidation, cache-miss retry, idempotent file selection and a
  peer-reconnection lock-order correction. Evictable data is not advertised
  or uploaded to peers. See `docs/rolling-cache.md`. Other dependencies remain
  resolved by Cargo; Cargo.lock records exact versions.
- **React, React Native and Amazon Vega SDK components** retain their respective
  upstream licences and SDK terms. SDK binaries, sysroots, toolchains and npm
  dependencies are not redistributed here. Generated Kepler bridge files retain
  their generated-code notices.
- **FFmpeg 7.1.3**, FFmpeg contributors: https://ffmpeg.org/ — LGPL-2.1-or-later
  for the configured subset. Unmodified source:
  https://ffmpeg.org/releases/ffmpeg-7.1.3.tar.xz . `scripts/build-remux.sh` pins
  its checksum and exact configuration; GPL/nonfree components are not enabled.
  The native module statically links libavformat, libavcodec and libavutil for
  stream-copy remuxing. The app includes the LGPL licence and source/build notice
  under `assets/third-party`. No decoding or encoding is enabled in this build.
- **Big Buck Bunny**, Blender Foundation / Peach project:
  https://peach.blender.org/ — Creative Commons Attribution 3.0.
  Only torrent metadata is provided as a test fixture; the movie is not bundled.

Stremio and Amazon product names identify compatibility, not endorsement.
Before distributing compiled packages, include the applicable dependency notices
and corresponding source required by their licences. This source upload does not
grant a new licence over third-party code.
