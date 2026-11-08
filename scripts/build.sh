#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
: "${VEGA_SDK_PRIVATE:?Set VEGA_SDK_PRIVATE; see README.md}"
frontend="$root/.build/stremio-web"
revision=f70766cf76dc993689d8dac2f5598d1d24a80dc6
mkdir -p "$root/.build"
if [[ ! -d "$frontend/.git" ]]; then
  git clone https://github.com/Stremio/stremio-web.git "$frontend"
fi
cd "$frontend"
[[ $(git rev-parse HEAD) == "$revision" ]] || git checkout --detach "$revision"
patch="$root/torrent-probe/frontend-controls/stremio-remote-keyboard.patch"
if git apply --check "$patch" 2>/dev/null; then
  git apply "$patch"
else
  git apply --reverse --check "$patch"
fi
tv_patch="$root/torrent-probe/frontend-tv/stremio-tv-shell.patch"
if git apply --check "$tv_patch" 2>/dev/null; then
  git apply "$tv_patch"
else
  git apply --reverse --check "$tv_patch"
fi
mkdir -p "$frontend/src/StreamioTV"
cp "$root/torrent-probe/frontend-tv/"*.ts "$root/torrent-probe/frontend-tv/"*.tsx "$root/torrent-probe/frontend-tv/"*.less "$frontend/src/StreamioTV/"
npx --yes pnpm@11.8.0 install --frozen-lockfile --ignore-scripts
NODE_PATH="$frontend/node_modules" node "$root/torrent-probe/frontend-controls/keyboard.test.cjs"
NODE_PATH="$frontend/node_modules" node "$root/torrent-probe/frontend-tv/api.test.cjs"
SERVICE_WORKER_DISABLED=true npx --yes pnpm@11.8.0 build

wrapper="$root/torrent-probe/stremio-wrapper"
bash "$root/scripts/build-remux.sh"
export STREAMIO_FFMPEG_ROOT="$root/.build/remux/ffmpeg-7.1.3"
mkdir -p "$wrapper/assets/stremio"
cp -a build/. "$wrapper/assets/stremio/"
cp "$root/torrent-probe/frontend-controls/vega-tv.js" "$wrapper/assets/stremio/vega-tv.js"
cp "$root/assets/branding/streamio4fire-icon.png" "$wrapper/assets/stremio/images/streamio4fire-icon.png"
python3 - "$wrapper/assets/stremio/index.html" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1])
s = p.read_text()
assert '<head>' in s, 'Upstream HTML head changed'
s = s.replace('<head>', '<head><script src="/tv.js"></script>', 1)
p.write_text(s)
PY

cd "$root/torrent-probe"
bash build-armv7.sh --embedded
export PROBE_RUST_ARCHIVE="$root/torrent-probe/target/armv7-unknown-linux-gnueabihf/release/libvega_torrent_probe.a"
cd vega-module
npm ci --ignore-scripts --no-audit
npm run build:js
vega build -t armv7 -b Release
npm pack --ignore-scripts
cd "$wrapper"
# Refresh the local native tarball integrity in the tracked lockfile.
npm install --ignore-scripts --no-audit ../vega-module/amazon-devices-vegatransport-0.0.1.tgz
node addonLinks.test.cjs
node nativePlayback.test.cjs
npx --no-install tsc --noEmit
npx --no-install react-native build-vega --build-type Debug --target armv7
