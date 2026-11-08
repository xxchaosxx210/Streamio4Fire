# Playback regression — 8 November 2026

Scope: installed native-playback branch, timeline and compact buffering overlay.

Automated checks passed:

- Timeline bounds, pointer mapping, hold acceleration, cancellation and single-use commit.
- 30 native playback bridge, remote and remux-boundary checks.
- Seven addon-link cases and wrapper TypeScript checking.
- Navigation geometry checks.
- Ten Rust tests, including large-file HTTP ranges, rolling eviction/backward seek,
  active-download protection, disk reserve and settings persistence.

On the Fire Stick, screenshots verified a paused 5:52 position with a held-arrow
preview at 8:02. Back cancelled that preview and retained 5:52 without leaving
playback. A later preview at 7:02 was committed with injected Enter; the actual
clock showed 7:02 afterward and picture playback resumed. The compact transparent
buffering indicator was captured during seeking in the preceding screenshot check.

The SDK's synthetic KEY_SELECT was not mapped to a confirm event on this device.
KEY_ENTER generated the Select event. This explains unsuccessful initial synthetic
confirmation attempts; the user's physical-remote confirmation remains separate.
Some scripted sequences also ran during media preparation and are not counted as
successful seek tests. The larger paused-commit sequence was inconclusive, and
pointer dragging, audio sync and long-duration endurance were not reverified.

After Back, the cache reported no error, rolling mode, zero active entries and
230,866,944 disk bytes against a 1,610,612,736-byte limit. Source-route inspection
needed a retry while the WebView remounted. Runtime output included SDK data-root
warnings; this run does not establish a warning-free platform log.

Temporary remote-key tracing was confined to the local diagnostic build source,
then removed before rebuilding and restoring the normal installer. No source URLs,
account settings or raw device logs are included in this report.
