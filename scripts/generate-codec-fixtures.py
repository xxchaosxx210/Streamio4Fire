"""Generate original, short compatibility samples. Requires a local FFmpeg binary.

Usage: python3 scripts/generate-codec-fixtures.py /path/to/ffmpeg OUTPUT_DIR
Generated binaries are test inputs, not release assets or codec libraries.
"""
import json
import pathlib
import subprocess
import sys

ffmpeg, output = sys.argv[1:3]
root = pathlib.Path(output)
root.mkdir(parents=True, exist_ok=True)
cases = [
    ("mp4-h264-aac", "mp4", "libx264", "aac", []),
    ("mkv-h264-aac", "mkv", "libx264", "aac", []),
    ("mkv-h264-ac3", "mkv", "libx264", "ac3", []),
    ("mkv-h264-eac3", "mkv", "libx264", "eac3", []),
    ("mkv-h264-dts", "mkv", "libx264", "dca", ["-strict", "-2"]),
    ("mkv-hevc-aac", "mkv", "libx265", "aac", []),
    ("mkv-hevc10-aac", "mkv", "libx265", "aac", ["-pix_fmt", "yuv420p10le"]),
    ("mp4-hevc-aac", "mp4", "libx265", "aac", ["-tag:v", "hvc1"]),
    ("webm-vp9-opus", "webm", "libvpx-vp9", "libopus", []),
    ("webm-vp8-vorbis", "webm", "libvpx", "libvorbis", []),
    ("avi-mpeg4-mp3", "avi", "mpeg4", "libmp3lame", []),
    ("ts-h264-aac", "ts", "libx264", "aac", []),
    ("mkv-h264-mp3", "mkv", "libx264", "libmp3lame", []),
    ("mkv-h264-flac", "mkv", "libx264", "flac", []),
    ("avi-h264-mp3", "avi", "libx264", "libmp3lame", []),
    ("mkv-mpeg4-mp3", "mkv", "mpeg4", "libmp3lame", []),
    ("mp4-mpeg4-aac", "mp4", "mpeg4", "aac", []),
]
if len(sys.argv) > 3:
    cases = [case for case in cases if case[0] in sys.argv[3:]]
manifest = []
for name, extension, video, audio, extra in cases:
    dest = root / f"{name}.{extension}"
    options = ["-preset", "ultrafast"] if video in ("libx264", "libx265") else []
    if video == "libx265":
        options += ["-x265-params", "log-level=error:pools=2:frame-threads=2"]
    if video.startswith("libvpx"):
        options += ["-deadline", "realtime", "-cpu-used", "8", "-b:v", "600k"]
    if extension == "mp4":
        options += ["-movflags", "+faststart"]
    command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
               "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
               "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000",
               "-t", "16", "-c:v", video, "-pix_fmt", "yuv420p", "-threads", "2",
               "-c:a", audio, "-ac", "2", "-af", "volume=0.04", *options, *extra, str(dest)]
    subprocess.run(command, check=True)
    manifest.append({"id": name, "file": dest.name, "video": video,
                     "audio": audio, "bytes": dest.stat().st_size})
    print(name, dest.stat().st_size, flush=True)
(root / "fixtures.json").write_text(json.dumps(manifest, indent=2) + "\n")
