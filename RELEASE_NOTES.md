# fKey Playback v1.2.0 — Smart Rotation Queue + prebundled yt-dlp

Made by **fKey Labs Inc.** · Windows x64 / Linux / macOS · Node.js 22.13+

## Highlights

- **Upcoming** holds unplayed videos; **Recycled** holds previously played videos until the next rotation. New content is never blocked behind recycled content.
- **Play Next** priority lane; **Next Rotation** deferred lane; explicit Play Now, Move to Current/Next Rotation, Recycle, Remove, multi-select move and sorting/shuffle.
- Automatically begins the next rotation only after priority and Upcoming are exhausted. Viewer voting uses unplayed choices first. Unavailable embeds are quarantined rather than endlessly replayed.
- Import an extracted YouTube playlist directly to Play Next, Upcoming or Next Rotation. Preserve playlist order or sort oldest/newest where publication metadata is available. Duplicate detection and atomic imports retained.
- **Windows x64 release ZIP bundles yt-dlp.exe** from the official 2026.08.19 release with SHA-256 verification, accompanying upstream license and third-party notices. No extra playlist extraction installation required on Windows x64.
- All previous controls remain: owner seek/pause/replay/skip, saved progress, OBS lower third, title size/visibility controls, Twitch chat voting, and Windows boot startup.

## Installation

1. Stop the old Playback server and back up your entire `data` folder.
2. Download `Playback-v1.2.0.zip` below and extract to a permanent folder such as `C:\Playback`.
3. Restore your existing `data` folder. Launch `start-player.bat`, or re-register Windows boot autostart with `INSTALL-AUTO-START.bat` if you use it.
4. Open `http://127.0.0.1:4177/control`. Use **Smart Rotation Queue** to see your lanes and **YouTube Playlist Importer** to select the import destination.
5. Refresh the OBS Browser Source after upgrading.

**Migration:** Existing state is moved to schema v2. Your current video, timestamp, queue, settings, voting, and saved audio remain unchanged. Old queued videos begin as Upcoming in Rotation 1. A `state.before-rotation-migration.json` backup is written automatically. Downgrading to v1.1.0 is not supported after migration.

**Bundling/security:** yt-dlp is a separate third-party executable, not MIT-licensed as part of Playback. The bundled PyInstaller executable contains GPLv3+ components; see `tools/yt-dlp-licenses/` and `tools/README.md`. The source repo excludes binaries. The official release ZIP includes them. The application only imports metadata; it does not download videos or authorize rebroadcasting.

**Limitations:** Windows auto-start starts the server, not OBS or YouTube playback before login. Private/age-restricted/geoblocked videos may not extract or embed. Publication-date sorting depends on available upstream metadata. Validate real YouTube extraction and OBS playback on the target station before unattended use.