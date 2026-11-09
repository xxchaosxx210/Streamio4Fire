# Release playback investigation — 9 November 2026

## Failure isolated to the development build

The previous installer used Debug mode. Two app-specific SIGABRT reports showed
roughly 350 threads. Resolving the core against the exact installed ARM runtime
libraries identified the failing path as C++ thread creation from
`TaskThread::start`, called by `MediaTrackImpl::onNeedData`. The failure occurred
when the media pipeline needed another worker; it does not identify the media
pipeline as the source of the retained workers.

Of the resolved worker stacks, 247 were waiting in the Asio resolver service's
work scheduler inside `libkeplerscript-4.so.4`. Live Debug measurements showed
about 28–30 additional threads per minute, predominantly numbered `JSThread`
workers. The Rust worker group remained small.

Growth also occurred on the home screen and with a locally generated H.264/AAC
MP4 in URL mode, without torrents, remuxing, MediaSource or peer-statistics
polling. In that control, threads increased from 132 to 174 in about 85 seconds.
Experiments changing MP4 initialization, video-view rendering, remote-hook
subscription or statistics polling did not remove the growth and are not part
of the published fix.

The clean committed application was rebuilt in Release mode. The compiled
bundle has `__DEV__=false`; the WebView development inspector is disabled. Idle
thread count stayed near 62 instead of increasing every two seconds. This
isolates the mitigation to the build configuration. A development-service
reconnect loop is a plausible trigger, but the exact SDK call retaining the
resolver workers has not been established.

## Build change

`scripts/build.sh` now creates a Release wrapper package, matching the native
module's existing Release build. The documented installation path is
`build/armv7-release`. No codec, cache, remote-input or remux implementation was
changed for this mitigation. Normal launch mode remains enabled; temporary
debugger executables were removed during the earlier launch restoration.

## Validation

The installed Release package completed a **32 minute 19 second mixed playback
and seek session** on the same Stick, using the same HEVC/E-AC-3 MKV source that
exercised the earlier failure. This includes a deliberate paused seek; it is not
30 uninterrupted minutes of moving video. The media clock advanced from 557.379
to 2242.778 seconds, including the ten-second seek.

The [34 numeric samples](release-endurance-2026-11-09.jsonl) show:

- 88–101 threads throughout, starting at 95 and ending at 89, instead of the
  Debug build's continuing growth toward roughly 350.
- Resident memory between 193.91 and 284.61 MiB.
- Zero sampled cache errors, cache-limit overruns, closed or ended states.
- No flat sampled clock intervals after the deliberate pause was released.

The lifecycle process ID stayed unchanged from the post-launch check through the
end; process age was 34 minutes 28 seconds at the final check. The installed
Hermes bundle's SHA-256 matches the built Release bundle. Normal home and source
navigation opened successfully. A paused remote timeline action moved the clock
from 707.138 to 717.138 seconds, and playback resumed. The user separately
confirmed moving picture, working audio and audio/video sync during this run.

The investigation-only video server/reverse connection, inspector/cache port
forwards and temporary on-device screenshots were removed. Playback was left
running normally. The saved installer now contains the tested Release package
(SHA-256 `1acc5555bf21377f4ec455c781abc3418b98cd354993e576b1f01f9e77c64ad6`).

These results validate the build-mode mitigation on this device and source.
A whole-film run, all codec combinations, deliberate network failures, cache
eviction at a full budget and pointer dragging were not tested in this run.

The Release ARM package builds successfully. The timeline checks, 30 native
playback bridge/remote/boundary checks, seven addon-link cases, wrapper TypeScript
check and build-script syntax check pass.

Raw cores, runtime libraries, source addresses, account data and diagnostic media
are excluded from the repository. The generated MP4 control is a temporary host
test service, not an application dependency.
