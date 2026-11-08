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
- The WebView is completely unmounted before native playback, with a short
  handoff delay for its native window to be destroyed. Keeping it mounted with
  opacity zero can obscure video on Vega, even when media time advances.
- Back releases the native decoder, remounts the same source URL and releases
  the cache stream. App backgrounding also tears down native playback.
- Position is saved every five seconds and on close. Up to 100 per-video resume
  entries live in local WebView storage. The latest native position is also
  persisted through Vega AsyncStorage while the browser is unmounted. A ready
  handshake transfers it back after the page's listener mounts. Reopening the same movie/episode resumes
  across source changes. Completion/near-end clears its entry. This is local
  resume only; Stremio account watch-history synchronisation is not implemented.

The bridge rejects non-HTTP media URLs, malformed payloads and messages from
outside the bundled UI. Vega message events sometimes omit their declared URL,
so the wrapper uses its tracked main-page URL as the fallback. Source URLs and
addon configuration are not logged or committed.

## Validation — 8 November 2026

- Wrapper TypeScript checking, 22 bridge/remote regression cases and seven addon-link
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
  dismissed it and restored the TV interface. Focus feedback uses high
  opacity so an actionable focused button does not resemble a disabled control.

## Browser/native surface regression

The first integration retained an invisible WebView. The user reported that
native controls appeared over the source page without video. This matches a
[reported Vega native-window interaction](https://community.amazondeveloper.com/t/webview-ui-controls-on-top-of-keplervideosurfaceview-on-vega-os/29804).
Opacity is insufficient: the browser must be unmounted. Only the validated local
source URL and the latest progress are retained, without storing media URLs in
resume storage. The startup watchdog is suspended during native playback and
restarted when the source page is remounted.

The user's same 2.37 GB MKV showed visible video after this correction. The
WebView debugger reported zero mounted pages during playback, and Back remounted
the original source route. Resume seeking waits for a playing event rather than
using duration alone, which can be available before the new source is seekable.

Progress is retained in native AsyncStorage while the browser is unmounted,
then delivered after the rebuilt page signals readiness. A saved position of
420.735 seconds survived termination and relaunch. Remote presses use the latest
focus state and consume paired down/up events once, including release-only Select.

## Seeking regression

The live torrent engine had two independent hazards: file-selection updates held
the torrent lock while reconnecting peers (opposite the scheduler's lock order),
and repeated Range requests reset partial chunk state even when the selected file
was unchanged. Reconnection now runs outside the torrent lock, and unchanged
live/paused file selections return immediately. The real synthetic-peer rolling
test repeats selection 1,000 times during streaming, eviction and backwards reads;
all eight Rust tests pass. The lock-order fix alone still stalled this regression.

The rebuilt ARM engine was installed and the same MKV played with visible picture.
Back restored the source list and the cache endpoint responded normally. However,
the +10 button still did not produce an actual time jump on this MKV. A generated
static HTTP MP4 control demonstrated native backward seeking, so button delivery
alone is not evidence of source-specific seek support. Large torrent MP4 seeking
has not yet been verified with this rebuilt engine.

The controls now report a pending seek, verify the media clock, and explain when
the position has not changed rather than silently claiming success. The earlier
short-sample physical +10 confirmation does not establish seeking for this MKV.
Amazon also documents a platform-specific Matroska HTTP seeking issue in its
[native-player discussion](https://community.amazondeveloper.com/t/native-kepler-player-controls-not-working-for-mp4-files-with-mkv-container/28603).
No operating-system update was installed as part of these fixes.

The subsequent [MKV seeking workaround](mkv-seeking.md) resolves this torrent
playback case through in-process stream-copy remuxing and native MediaSource.
The user confirmed +10, −10, Play/Pause and audio sync on the physical remote.
The native HTTP/Matroska limitation still applies to direct external MKV URLs.

The [codec matrix](native-codecs.md) remains a limited short-sample test, not a
claim of all resolutions, profiles, audio output configurations or endurance.
Older MPEG-4 Part 2/DivX-style video remains a known gap; no software decoder was
added in this change. Subtitles and audio-track selection are not yet implemented
in the native controls. A pre-native package was retained for local rollback.

## Playback timeline

The bottom controls include a focusable playback timeline. Press Up from the
button row to focus it, then Left/Right to preview a jump. Holding an arrow
accelerates from 10-second steps to 30 seconds after two seconds and 60 seconds
after five seconds. Select commits the preview; Back cancels it without leaving
the movie. Moving focus to another control also cancels the preview.

When controls are hidden, Left/Right reveals and focuses the timeline. Pointer
or touch input can drag the marker and commit on release. Preview movement does
not restart playback; only committing a target invokes the existing seek path.
The dedicated rewind/fast-forward keys and ±10-second buttons remain available.
Controls stay visible while a preview is active and otherwise hide during playback.

Timeline calculation and preview lifecycle tests cover bounds, pointer mapping,
acceleration, cancellation and single-use commit. The new timeline still needs
on-device focus, hold and pointer verification; the Stick was unreachable during
this implementation. The earlier physical-remote confirmation above applies to
the existing ±10 controls, not this new timeline.
