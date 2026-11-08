cmake_minimum_required(VERSION 3.19)
project(VegaTransport LANGUAGES CXX C)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_CXX_STANDARD 17)
find_package(turbomoduleAPI CONFIG REQUIRED)
if(NOT DEFINED ENV{PROBE_RUST_ARCHIVE})
  message(FATAL_ERROR "Set PROBE_RUST_ARCHIVE to the built ARMv7 torrent archive")
endif()
file(GLOB GENERATED kepler/turbo-modules/generated/*.cpp)
kepler_add_turbo_module_library(VegaTransport ${GENERATED}
  kepler/turbo-modules/VegaTransport.cpp kepler/turbo-modules/StreamioRemux.cpp kepler/AutoLinkInit.cpp)

if(NOT DEFINED ENV{STREAMIO_FFMPEG_ROOT})
  message(FATAL_ERROR "Set STREAMIO_FFMPEG_ROOT to the configured ARMv7 FFmpeg source/build directory")
endif()
set(FFMPEG "$ENV{STREAMIO_FFMPEG_ROOT}")
target_include_directories(VegaTransport PRIVATE "${FFMPEG}")
target_link_options(VegaTransport PRIVATE "-Wl,-Bsymbolic" "-Wl,--exclude-libs,ALL")
target_link_libraries(VegaTransport PRIVATE "$ENV{PROBE_RUST_ARCHIVE}"
  "${FFMPEG}/libavformat/libavformat.a" "${FFMPEG}/libavcodec/libavcodec.a"
  "${FFMPEG}/libavutil/libavutil.a" pthread dl m)
install(TARGETS VegaTransport)
