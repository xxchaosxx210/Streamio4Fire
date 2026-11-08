# Native compatibility probe

This is a separate diagnostic app (`com.firetvdiagnostics.nativecodeccheck`).
It does not replace the production WebView player or change the user's addons.
It uses Vega's `VideoPlayer`/`KeplerVideoView` directly in URL mode.

With the Vega SDK environment loaded, build using `scripts/build-codec-check.sh`.
Generate original test patterns and a quiet stereo tone with a local FFmpeg:

```sh
python3 scripts/generate-codec-fixtures.py /path/to/ffmpeg .build/codec-fixtures
python3 scripts/codec-fixture-server.py .build/codec-fixtures .build/codec-results.jsonl
```

In another terminal, connect the Stick and start a **temporary test-only tunnel**:

```sh
vega exec vda -s DEVICE reverse tcp:18080 tcp:18080
vega device -d DEVICE install-app --packagePath .build/native-codec-check/build/armv7-debug/native-codec-check_armv7.vpkg
vega device -d DEVICE launch-app --appName com.firetvdiagnostics.nativecodeccheck.main
```

The app cycles through 17 combinations, then displays recent results. The local
server records structured results in JSONL. Generated files and results must stay
in `.build`, which is ignored. No external media or private configuration is used.
Stop the test app, remove the reverse tunnel and stop the fixture server afterwards.
This host is only for the test suite; normal playback remains self-contained.

`playing` means a playing event and advancing media time were observed without
a reported error. It is **not** a claim of verified audible audio or decoded video
for every sample. On this SDK the frame count, video dimensions and audio-track
getters may return zero even with a visible moving picture. Confirm picture and
tone by observation. Seek and pause/resume are API checks, not physical remote
acceptance tests. Samples are 16 seconds, 640×360, stereo; they do not validate
4K, HDR, high bitrates, multichannel passthrough or sustained streaming.

The next integration gate is a same-device test through the actual rolling-cache
HTTP endpoint, then native controls, watch progress and clean return to browsing.
