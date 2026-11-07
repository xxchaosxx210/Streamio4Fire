# Third-party notices

- **Stremio Web**, Stremio contributors:
  https://github.com/Stremio/stremio-web
  Commit `f70766cf76dc993689d8dac2f5598d1d24a80dc6`.
  GNU GPL version 2; the upstream licence is copied to
  `LICENSES/Stremio-Web-GPL-2.0.md`. The build obtains the source separately.
  `torrent-probe/frontend-controls/keyboard.ts` and its patch derive from this
  project and retain that licence. Changes add Fire TV Back and media-key mapping.
- **rqbit / librqbit 8.1.1**, rqbit contributors:
  https://github.com/ikatson/rqbit — Apache-2.0. Resolved by Cargo; dependency
  source is not vendored in this repository. Cargo.lock records exact versions.
- **React, React Native and Amazon Vega SDK components** retain their respective
  upstream licences and SDK terms. SDK binaries, sysroots, toolchains and npm
  dependencies are not redistributed here. Generated Kepler bridge files retain
  their generated-code notices.
- **Big Buck Bunny**, Blender Foundation / Peach project:
  https://peach.blender.org/ — Creative Commons Attribution 3.0.
  Only torrent metadata is provided as a test fixture; the movie is not bundled.

Stremio and Amazon product names identify compatibility, not endorsement.
Before distributing compiled packages, include the applicable dependency notices
and corresponding source required by their licences. This source upload does not
grant a new licence over third-party code.
