#pragma once
#include <cstdint>
using Write = int (*)(void*, const uint8_t*, int);
using Cancel = int (*)(void*);
struct StreamioInput {
    int (*read)(void*, uint8_t*, int);
    int64_t (*seek)(void*, int64_t, int);
    void* opaque;
};
extern "C" int streamio_remux_section(const StreamioInput*, double, Write, void*, Cancel, void*, double*, double*);
