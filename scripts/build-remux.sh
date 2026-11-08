#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
: "${VEGA_SDK_PRIVATE:?Set VEGA_SDK_PRIVATE to the Vega native SDK build/private directory}"
work="$root/.build/remux"
mkdir -p "$work"
archive="$work/ffmpeg-7.1.3.tar.xz"
if [[ ! -f "$archive" ]]; then
  curl -fL https://ffmpeg.org/releases/ffmpeg-7.1.3.tar.xz -o "$archive"
fi
printf '%s  %s\n' f0bf043299db9e3caacb435a712fc541fbb07df613c4b893e8b77e67baf3adbe "$archive" | sha256sum -c -
[[ -d "$work/ffmpeg-7.1.3" ]] || tar -xJf "$archive" -C "$work"
sdk=$(realpath "$VEGA_SDK_PRIVATE")
tool="$sdk/toolchain/armv7/linux/bin"
sysroot="$sdk/sysroot-armv7-release"
runtime="$sysroot/usr/lib/arm-oe-linux-gnueabi/11.2.0"
cd "$work/ffmpeg-7.1.3"
./configure --enable-cross-compile --target-os=linux --arch=arm --cpu=cortex-a7 \
  --cc="$tool/armv7a-linux-gnueabihf-clang" --ar="$tool/llvm-ar" --ranlib="$tool/llvm-ranlib" \
  --nm="$tool/llvm-nm" --strip="$tool/llvm-strip" --sysroot="$sysroot" \
  --extra-cflags="-fPIC" --extra-ldflags="-B$runtime -L$runtime --rtlib=libgcc --unwindlib=libgcc" \
  --disable-everything --disable-autodetect --disable-doc --disable-debug \
  --disable-ffmpeg --disable-ffplay --disable-ffprobe --disable-avdevice --disable-swscale --disable-postproc \
  --disable-asm --enable-network --enable-protocol=file,http,tcp \
  --enable-demuxer=matroska,mov --enable-muxer=mp4 --enable-parser=h264,hevc,aac,ac3 \
  --enable-bsf=aac_adtstoasc,extract_extradata --enable-small
make -j"${CARGO_BUILD_JOBS:-4}" libavformat/libavformat.a libavcodec/libavcodec.a libavutil/libavutil.a
destination="$root/torrent-probe/stremio-wrapper/assets/third-party"
mkdir -p "$destination"
cp COPYING.LGPLv2.1 "$destination/FFmpeg-LGPL-2.1.txt"
printf '%s\n' 'FFmpeg 7.1.3, LGPL-2.1-or-later. No GPL/nonfree components enabled.' \
  'Corresponding source: https://ffmpeg.org/releases/ffmpeg-7.1.3.tar.xz' \
  'Unmodified source. Rebuild configuration: scripts/build-remux.sh in Streamio4Fire.' > "$destination/FFmpeg-NOTICE.txt"
