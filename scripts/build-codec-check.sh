#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
: "${VEGA_SDK_PRIVATE:?Set VEGA_SDK_PRIVATE; see README.md}"
app="$root/.build/native-codec-check"
mkdir -p "$app/src"
cp "$root/torrent-probe/codec-check/"*.json "$root/torrent-probe/codec-check/"*.js "$root/torrent-probe/codec-check/manifest.toml" "$app/"
cp "$root/torrent-probe/codec-check/src/"*.tsx "$app/src/"
cd "$app"
npm ci --ignore-scripts --no-audit
npx --no-install tsc --noEmit
npx --no-install react-native build-vega --build-type Debug --target armv7
