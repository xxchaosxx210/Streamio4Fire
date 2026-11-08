# Native codec feasibility — 8 November 2026

Branch: `feat/native-playback`, based on the TV-interface branch. This is an
isolated compatibility prototype, **not a replacement for production playback**.

Vega's native `VideoPlayer`/`KeplerVideoView` URL mode was tested on the physical
ARMv7 Fire TV Stick, using `@amazon-devices/react-native-w3cmedia` 2.3.5. The test
app built and passed TypeScript checking. Files were generated moving test
patterns plus a quiet stereo tone, 16 seconds at 640×360/24fps.

## Measurements

| Container | Video | Audio | Native result |
|---|---|---|---|
| MP4 | H.264 | AAC | Playing; seek and pause/resume |
| MKV | H.264 | AAC, AC-3, E-AC-3, DTS, MP3, FLAC | All six pairings playing; seek and pause/resume |
| MKV | HEVC 8-bit / 10-bit | AAC | Both playing; seek and pause/resume |
| MP4 | HEVC 8-bit | AAC | Playing; seek and pause/resume |
| WebM | VP9 | Opus | Playing; seek and pause/resume |
| WebM | VP8 | Vorbis | Playing; seek and pause/resume |
| MPEG-TS | H.264 | AAC | Playing; seek and pause/resume |
| AVI | H.264 | MP3 | Playing; seek and pause/resume |
| AVI | MPEG-4 Part 2 | MP3 | Did not start within 20 seconds |
| MKV | MPEG-4 Part 2 | MP3 | Did not start within 20 seconds |
| MP4 | MPEG-4 Part 2 | AAC | Did not start within 20 seconds |

Raw synthetic measurements: [JSONL](validation/native-codecs-2026-11-08.jsonl).
Twenty observations cover seventeen unique combinations, with three repeated
controls. Fourteen combinations reached advancing playback; three MPEG-4 Part 2
combinations did not. The comparison points to a video-codec gap rather than
blanket AVI-container incompatibility. It does not establish failure for every
MPEG-4 profile or every AVI file.

Pictures were visually observed in MP4/H.264, MKV/H.264 and WebM/VP9 tests.
The user confirmed a moving picture and audible tone during the run. That was
not a separate listening confirmation for every audio codec. Dolby/DTS
multichannel and passthrough remain unverified.

The SDK reported zero frame counts, dimensions and audio-track counts even with
visible video. Therefore `playing` means a playing event and advancing media
time without a reported error, not independent proof of both decoded outputs.
No 1080p/4K, HDR, high-bitrate, long-duration or physical-remote acceptance claim
is made from these short samples.

## Integration decision

Use the native player as the first path for the common modern formats. Keep
MPEG-4 Part 2 (often associated with older DivX/Xvid material) as a known gap;
renaming or remuxing its container is insufficient based on these controls. A
software decoder or transcoding path needs separate implementation and device
performance tests before promising support.

Before production handoff: native player through the existing rolling-cache
HTTP endpoint, remote controls, progress/resume, source-error UI, app lifecycle,
and return to the same TV source screen. The current production player remains
unchanged while these are developed.

The fixture host is temporary test tooling, accessed through a loopback VDA
reverse tunnel. An attempted reuse of the embedded host in the standalone test
app failed to start, so it was removed as an unrelated test dependency. No host
or tunnel is introduced into the normal app's runtime architecture.

References: [Vega media API](https://developer.amazon.com/docs/vega/2.0/media-player),
[native URL-mode example](https://developer.amazon.com/docs/vega/2.0/media-player-hello-world).
