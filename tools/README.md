# Bundled YouTube playlist extractor (Windows)

Official fKey Playback **Windows release ZIPs** include `yt-dlp.exe` beside this
README. No manual download, API key, or separate Python install is required on
**Windows x64**. The executable extracts playlist **metadata only**, not video files.

- yt-dlp release: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- Version: `2026.08.19`
- SHA-256 (`yt-dlp.exe`): `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`
- Manifest: `yt-dlp-manifest.json` (included in official release ZIP)
- Third-party notices: `yt-dlp-licenses/LICENSE` and `yt-dlp-licenses/THIRD_PARTY_LICENSES.txt`

**Licensing:** The Playback source is MIT. yt-dlp source is Unlicense, but the
standalone PyInstaller Windows executable bundles components covered by GPLv3+.
The yt-dlp executable remains a separately invoked third-party program; its
license terms and upstream corresponding source code are at the linked release.
The official binary is unchanged by Playback.

For development/source checkouts, run `python ops/bundle-yt-dlp.py` on a machine
with access to GitHub before making the complete Windows distribution.
You can use `YT_DLP_PATH` to select your own executable instead.

On Linux/macOS, install yt-dlp into `PATH` or provide a compatible `tools/yt-dlp`
executable. Windows ARM64 users should select the upstream `yt-dlp_arm64.exe` and
configure `YT_DLP_PATH`; the bundled x64 file is not a native ARM build.

Upstream publishes new builds frequently as YouTube changes. Release pinning is
intentional, and updating should involve a fresh verified upstream binary.