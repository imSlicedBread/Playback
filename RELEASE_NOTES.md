# fKey Playback v1.2.1 — Playlist importer reset and lower-third alignment

fKey Playback is a local OBS/YouTube station made by **fKey Labs Inc.**

## Changes in v1.2.1

- **Ready for the next playlist:** A successful **Import Selected to Queue** hides and clears the extracted video preview, selection, playlist URL, and starting index. The success confirmation remains visible and the URL field is focused for another playlist.
- **Retry without losing your work:** A failed import does not clear the preview, checked videos, or URL.
- **Settings preserved:** Import destination, playlist order, duplicate handling, and extraction batch size keep their selected values.
- **Aligned Lower Third editor:** The Vertical Anchor selector, Snap to Bottom, Snap to Top and Reset Lower Third controls now share a full-width responsive layout, with a position readout underneath.
- **Cache refresh:** Versioned UI assets avoid stale styling after upgrading.

## Existing capabilities retained

- Smart Rotation Queue: Play Next, Upcoming, Recycled and Next Rotation.
- YouTube playlist extraction and selective import, duplicate protection, and bulk sorting.
- OBS playback overlays and customizable lower-third labels and title text size.
- Persistent playback position, queue, settings and rotation state after restart.
- Windows startup task and operator dashboard.
- Official Windows x64 release includes checksum-verified **yt-dlp.exe** and its third-party licensing notices.

## Upgrade

1. Stop the existing Playback server and **back up the complete `data/` directory**.
2. Extract `Playback-v1.2.1.zip` into a permanent directory such as `C:\Playback`.
3. Restore `data/`, then start Playback, or reinstall the Windows boot task if you changed the installation location.
4. Refresh Control and Settings with **Ctrl+F5** to load the new styling.

**Compatibility:** The installer preserves rotation queues and your active video timestamp. An imported playlist does not interrupt the current video. Live OBS/YouTube behavior should still be tested on the streaming PC. Windows release package ships the upstream third-party yt-dlp executable only after checksum verification.