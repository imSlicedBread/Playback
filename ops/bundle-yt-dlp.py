#!/usr/bin/env python3
"""Fetch a pinned official yt-dlp Windows executable and preserve notices.

Only used for Windows release packaging. Never downloads media.
"""
import hashlib
import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

VERSION = '2026.08.19'
WINDOWS_SHA256 = '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'
WINDOWS_SIZE = 17840399
RELEASE_BASE = f'https://github.com/yt-dlp/yt-dlp/releases/download/{VERSION}'
SOURCE_BASE = f'https://raw.githubusercontent.com/yt-dlp/yt-dlp/{VERSION}'
ROOT = Path(__file__).resolve().parents[1]


def fetch_verified(url, destination, *, sha256=None, min_bytes=100, max_bytes=24*1024*1024, opener=urlopen):
    """Stream to a temporary file, verify checksum, replace destination atomically."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = Request(url, headers={'User-Agent': 'fKey-Playback-packager/1.2.0'})
    temp = destination.with_name(destination.name + '.download')
    digest = hashlib.sha256()
    length = 0
    try:
        with opener(request, timeout=90) as response, temp.open('wb') as file:
            while chunk := response.read(1024*1024):
                length += len(chunk)
                if length > max_bytes:
                    raise ValueError('yt-dlp download exceeded expected size')
                digest.update(chunk)
                file.write(chunk)
        if length < min_bytes:
            raise ValueError('yt-dlp download is incomplete')
        actual = digest.hexdigest()
        if sha256 and actual != sha256:
            raise ValueError(f'yt-dlp checksum mismatch: expected {sha256}, got {actual}')
        os.replace(temp, destination)
        return {'sha256': actual, 'size': length}
    finally:
        temp.unlink(missing_ok=True)


def bundle():
    tools = ROOT / 'tools'
    exe = tools / 'yt-dlp.exe'
    if exe.exists() and hashlib.sha256(exe.read_bytes()).hexdigest() == WINDOWS_SHA256:
        print('Official yt-dlp.exe is already present and checksum matches.')
    else:
        fetch_verified(f'{RELEASE_BASE}/yt-dlp.exe', exe, sha256=WINDOWS_SHA256,
                       min_bytes=WINDOWS_SIZE, max_bytes=WINDOWS_SIZE)
    legal = tools / 'yt-dlp-licenses'
    for filename in ('LICENSE', 'THIRD_PARTY_LICENSES.txt'):
        fetch_verified(f'{SOURCE_BASE}/{filename}', legal / filename, max_bytes=2*1024*1024)
    manifest = {
        'project': 'yt-dlp', 'version': VERSION, 'binary': 'tools/yt-dlp.exe',
        'sha256': WINDOWS_SHA256, 'size': WINDOWS_SIZE,
        'source': f'https://github.com/yt-dlp/yt-dlp/tree/{VERSION}',
        'release': f'https://github.com/yt-dlp/yt-dlp/releases/tag/{VERSION}',
        'redistribution': 'Upstream yt-dlp is Unlicense. Official PyInstaller Windows binaries incorporate GPLv3+ components; see tools/yt-dlp-licenses/THIRD_PARTY_LICENSES.txt.'
    }
    (tools / 'yt-dlp-manifest.json').write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print('Bundled yt-dlp', VERSION, 'SHA-256:', WINDOWS_SHA256)


if __name__ == '__main__':
    bundle()