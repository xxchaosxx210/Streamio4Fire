# TV interface branch

`feat/tv-interface` adds a remote-oriented shell around the bundled Stremio Web
player. It uses the existing on-device profile and installed addons. It does not
introduce a second account, hosted frontend, or laptop dependency.

Home → title details → season/episode → source → existing player. Search and
Streaming & Cache have larger controls; advanced settings and addon management
remain available through Settings. Back restores the previous TV screen, with
remembered card focus. Save closes the cache screen after the server accepts it.

The connection panel shows reported seeders/leechers, live connected peers,
download speed, elapsed time and the current stage. Missing addon counts say
Unknown. Connection progress is indeterminate; buffered seconds use actual media
buffer ranges. The panel hides on `playing` and returns after sustained buffering.
Metadata failures are caught before the player opens, with retry/source choices.
Technical details remain collapsed by default. This does not add transcoding.

Source files are in `torrent-probe/frontend-tv`; `scripts/build.sh` applies the
small upstream integration patch and copies these components into the pinned
frontend. Its ES5 target requires `Array.from` for Map/Set iterators. Run
`api.test.cjs` with the frontend's TypeScript available in NODE_PATH.

Device checks and physical remote acceptance are separate: automated focus,
navigation and playback checks do not replace testing the actual remote.

## Validation (7 November 2026)

- Production frontend and ARMv7 wrapper package built successfully. Webpack
  reports its existing bundle-size warnings. Full upstream TypeScript checking
  still has unrelated dependency/legacy errors; none point to StreamioTV.
- API regression checks run with the frontend's ES5 target; seven existing
  keyboard mapping cases pass.
- On the Stick: 73 home cards, search results, six seasons/eight first-season
  episodes for a series, episode-to-source routing, cache information and Save
  returning to Settings verified through the WebView debugging protocol.
- The freely licensed Big Buck Bunny fixture played (media readyState 4,
  advancing playback time). Loading panel disappeared; Escape returned to the
  TV source list without retaining the panel.
- Physical remote usability and sustained rebuffering remain user acceptance
  checks. Advanced settings/addon configuration retain the existing interface.
