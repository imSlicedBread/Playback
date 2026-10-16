# fKey Playback v1.2.2 — Lower Third opacity, height and editor improvements

### New in v1.2.2

- **Card background opacity**: 0% (transparent) to 100% (solid), leaving the video title fully opaque. Defaults to the previous 89% appearance.
- **Lower Third height**: Set an explicit height (4–65% of OBS frame) or leave 0 for Auto Height.
- **Drag-to-resize width and height**: Cyan corner now resizes in both directions, keeping the selected anchor edge fixed. Focus the handle and use arrow keys for fine control.
- **Better editor workspace**: Responsive large 16:9 preview alongside the geometry/opacity inspector on desktop, with safe-area and alignment guides; stacks vertically on narrow screens.
- **Persistent OBS synchronization**: New fields are validated and saved, and the OBS Browser Source uses the same renderer as the preview. Existing saved layouts migrate without changing their previous appearance.

### Upgrading from v1.2.1

Stop Playback and back up the complete `data/` directory. Extract the official `Playback-v1.2.2.zip` to a permanent folder, restore the saved data, and restart Playback. Windows autostart users should reinstall the scheduled tasks only when the installation path changes. Refresh the OBS Browser Source once after upgrading; then open **Settings → Lower Third**, edit, and click **Save Settings**. Existing playlist rotations, progress, imported videos, visibility toggles, custom colors and voting settings are retained.

**Windows executable:** The official GitHub Windows ZIP contains the pinned upstream `yt-dlp.exe` and third-party notices, checksum-verified before release. Linux/macOS builds need an independently installed `yt-dlp` or `YT_DLP_PATH`.

**Limitations:** Playback is designed for a trusted local workstation. The Node backend may start at Windows boot, but OBS and its YouTube browser source still require an interactive desktop. Actual OBS rendering and live Twitch/YouTube connectivity must be checked on your computer before relying on unattended broadcasts. A manual height too small for selected text scales can clip content; use Auto Height to prevent this.

---

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