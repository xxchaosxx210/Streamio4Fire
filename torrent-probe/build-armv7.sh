#!/usr/bin/env bash
set -euo pipefail
# Point to a Vega native build's private directory containing toolchain/ and
# sysroot-armv7-release/. Do not use a desktop Linux sysroot for the device.
: "${VEGA_SDK_PRIVATE:?Set VEGA_SDK_PRIVATE to the Amazon native SDK build/private directory}"
sdk_root=$(realpath "$VEGA_SDK_PRIVATE")
compiler="$sdk_root/toolchain/armv7/linux/bin/armv7a-linux-gnueabihf-clang"
sysroot="$sdk_root/sysroot-armv7-release"
runtime="$sysroot/usr/lib/arm-oe-linux-gnueabi/11.2.0"
test -x "$compiler"
test -f "$runtime/crtbeginS.o"
export CC_armv7_unknown_linux_gnueabihf="$compiler"
export CFLAGS_armv7_unknown_linux_gnueabihf="--sysroot=$sysroot -fPIC"
export CARGO_TARGET_ARMV7_UNKNOWN_LINUX_GNUEABIHF_LINKER="$compiler"
export RUSTFLAGS="-C relocation-model=pic -C link-arg=--sysroot=$sysroot"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
cd "$(dirname "$0")"
if [[ "${1:-}" == "--selftest" ]]; then
    cargo rustc --locked --release --features rolling-selftest --bin rolling-selftest \
        --target armv7-unknown-linux-gnueabihf -- \
        -C "link-arg=-B$runtime" -L "native=$runtime"
elif [[ "${1:-}" == "--embedded" ]]; then
    cargo build --locked --release --lib --target armv7-unknown-linux-gnueabihf
else
    cargo rustc --locked --release --bin vega-torrent-probe \
        --target armv7-unknown-linux-gnueabihf -- \
        -C "link-arg=-B$runtime" -L "native=$runtime"
fi
