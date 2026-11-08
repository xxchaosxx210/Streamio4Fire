# Native playback integration

Implemented on `feat/native-playback`, building on `feat/tv-interface`.
The wrapper pins Vega W3C Media 2.3.5, matching the native codec probe.

## Behaviour

- TV source selection resolves torrent metadata/file index, then sends a typed
  playback request from the bundled WebView to a native player overlay.
- Torrent media uses `http://127.0.0.1:11470/HASH/INDEX`, the same range-capable
  rolling-cache endpoint. No laptop server, test tunnel or transcoding is used.
- Ordinary HTTP(S) file sources can also use native URL mode. Known `.m3u8` and
  `.mpd` sources, sources requiring proxy headers, and clients without the native
  bridge retain the existing browser player. Opaque adaptive URLs may still need
  a future content-type based fallback.
- Native controls provide play/pause, ±10 seconds and Back to sources. D-pad
  navigation never changes volume. Playback hides the connection panel; normal
  controls hide after four seconds while playing. Sustained lack of advancing
  media time reveals buffering status, live peers/speed and reported availability.
- Initialization/media failures and a 45-second startup timeout show a readable
  source-choice message. A timeout is not presented as proof of a codec failure.
- Back releases the native decoder before returning to the mounted WebView and
  releasing the cache stream. App backgrounding also tears down native playback.
- Position is saved every five seconds and on close. Up to 100 per-video resume
  entries live in local WebView storage. Reopening the same movie/episode resumes
  across source changes. Completion/near-end clears its entry. This is local
  resume only; Stremio account watch-history synchronisation is not implemented.

The bridge rejects non-HTTP media URLs, malformed payloads and messages from
outside the bundled UI. Vega message events sometimes omit their declared URL,
so the wrapper uses its tracked main-page URL as the fallback. Source URLs and
addon configuration are not logged or committed.

## Validation — 8 November 2026

- Wrapper TypeScript checking, 14 bridge regression cases and seven addon-link
  cases pass. The frontend production build succeeds with existing size warnings.
- An MKV/H.264/AAC generated sample rendered inside the real app from the Stick's
  local HTTP server. A native Play/Pause event paused it; Back restored browsing.
  Temporary sample assets were removed before the final package.
- The licensed Big Buck Bunny torrent was selected through the TV source screen
  and played in the native overlay through the actual rolling-cache endpoint.
  The WebView had no HTML video element; native progress advanced and its picture
  was visually checked. This verifies native playback rather than browser fallback.
- Back returned to the same source route. Reselecting resumed around the saved
  position. Play/Pause, source-return and automatic progress persistence were
  checked with native input injection and WebView progress events.
- The user confirmed physical-remote Select on the highlighted +10-second button
  moved playback forward by ten seconds. Synthetic OK/Select injection did not
  reliably activate this SDK's touchable controls, so it is not substituted for
  that physical confirmation.
- A missing local video produced the native source-choice error view, and Back
  dismissed it without reloading the TV interface. Focus feedback uses high
  opacity so an actionable focused button does not resemble a disabled control.

The [codec matrix](native-codecs.md) remains a limited short-sample test, not a
claim of all resolutions, profiles, audio output configurations or endurance.
Older MPEG-4 Part 2/DivX-style video remains a known gap; no software decoder was
added in this change. Subtitles and audio-track selection are not yet implemented
in the native controls. A pre-native package was retained for local rollback.
