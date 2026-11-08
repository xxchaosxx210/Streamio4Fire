"""Loopback-only, Range-capable server for generated media and test results.

Usage: python3 scripts/codec-fixture-server.py FIXTURE_DIR RESULTS_JSONL
Use `vda reverse tcp:18080 tcp:18080` to connect the isolated test app.
This tool is never part of the production app or playback architecture.
"""
import http.server
import json
import mimetypes
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1]).resolve()
results = pathlib.Path(sys.argv[2])


class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.media(head=True)

    def do_GET(self):
        self.media()

    def do_POST(self):
        if self.path != "/results":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length <= 8192:
            self.send_error(413)
            return
        data = json.loads(self.rfile.read(length))
        with results.open("a") as output:
            output.write(json.dumps(data) + "\n")
        print(json.dumps(data), flush=True)
        self.send_response(204)
        self.end_headers()

    def media(self, head=False):
        name = self.path.split("?", 1)[0].lstrip("/")
        path = (root / name).resolve()
        if path.parent != root or not path.is_file():
            self.send_error(404)
            return
        size = path.stat().st_size
        if not head and path.suffix != ".json":
            print("CODEC_FIXTURE_REQUEST", path.name, flush=True)
        start, end = 0, size - 1
        value = self.headers.get("Range")
        if value:
            match = re.fullmatch(r"bytes=(\d+)-(\d*)", value)
            if not match:
                self.send_error(416)
                return
            start = int(match[1]);end = min(int(match[2]) if match[2] else end, end)
            if start > end:
                self.send_response(416);self.send_header("Content-Range", f"bytes */{size}");self.end_headers()
                return
        self.send_response(206 if value else 200)
        types = {".ts": "video/mp2t", ".mkv": "video/x-matroska", ".avi": "video/x-msvideo"}
        self.send_header("Content-Type", types.get(path.suffix, mimetypes.guess_type(path.name)[0] or "application/octet-stream"))
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if value:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not head:
            try:
                with path.open("rb") as source:
                    source.seek(start);remaining = end - start + 1
                    while remaining:
                        data = source.read(min(65536, remaining))
                        if not data:
                            break
                        self.wfile.write(data);remaining -= len(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, *_):
        pass


http.server.ThreadingHTTPServer(("127.0.0.1", 18080), Handler).serve_forever()
