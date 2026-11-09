#!/usr/bin/env python3
"""Wire TV navigation and fingerprint local assets without clearing user data."""
import hashlib
from pathlib import Path
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def prepare(index: Path) -> None:
    root = index.parent.resolve()
    html = index.read_text()
    if '<script src="/tv.js' not in html:
        if '<head>' not in html:
            raise ValueError('Upstream HTML head changed')
        html = html.replace('<head>', '<head><script src="/tv.js"></script>', 1)

    def fingerprint(match: re.Match) -> str:
        prefix, quote, reference = match.group(1, 2, 3)
        url = urlsplit(reference)
        if url.scheme or url.netloc or not url.path.endswith(('.css', '.js')):
            return match.group(0)
        relative = 'vega-tv.js' if url.path == '/tv.js' else url.path.lstrip('/')
        target = (root / relative).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            return match.group(0)
        digest = hashlib.sha256(target.read_bytes()).hexdigest()[:16]
        query = [(k, v) for k, v in parse_qsl(url.query) if k != 's4f-build']
        query.append(('s4f-build', digest))
        updated = urlunsplit(('', '', url.path, urlencode(query), url.fragment))
        return prefix + quote + updated + quote

    html = re.sub(r'''(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2''', fingerprint, html)
    index.write_text(html)


if __name__ == '__main__':
    prepare(Path(sys.argv[1]))
