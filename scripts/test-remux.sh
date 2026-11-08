#!/usr/bin/env bash
set -euo pipefail
# Use a host build of the same FFmpeg version (not the ARM libraries).
: "${STREAMIO_HOST_FFMPEG_ROOT:?Set STREAMIO_HOST_FFMPEG_ROOT to a configured host FFmpeg 7.1.3 build}"
root=$(cd "$(dirname "$0")/.." && pwd)
work="$root/.build/remux-test"
mkdir -p "$work"
ffmpeg="${FFMPEG:-ffmpeg}"
"$ffmpeg" -v error -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 \
  -t 8 -c:v libx264 -bf 3 -g 48 -pix_fmt yuv420p -c:a aac -y "$work/reordered.mkv"
ff="$STREAMIO_HOST_FFMPEG_ROOT"
"${CXX:-c++}" -std=c++17 -I"$ff" -I"$root/torrent-probe/vega-module/kepler/turbo-modules" \
  "$root/torrent-probe/vega-module/kepler/turbo-modules/StreamioRemux.cpp" \
  "$root/torrent-probe/codec-check/tools/remux-smoke.cpp" \
  "$ff/libavformat/libavformat.a" "$ff/libavcodec/libavcodec.a" "$ff/libavutil/libavutil.a" \
  -lpthread -lm -o "$work/remux-smoke"
for at in 0 2.5 5.5; do
  "$work/remux-smoke" "$work/reordered.mkv" "$at" "$work/output.mp4"
  "$ffmpeg" -v error -i "$work/output.mp4" -map 0 -fps_mode passthrough -enc_time_base demux -f null - 2> "$work/decode.log"
  if [[ -s "$work/decode.log" ]]; then cat "$work/decode.log";exit 1;fi
done
"$work/remux-smoke" "$work/reordered.mkv" 0 "$work/cancelled.mp4" cancel
