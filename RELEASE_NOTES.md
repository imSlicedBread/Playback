# fKey Playback v1.0.7 — centered transport controls

## New in v1.0.7

- Moved Previous / Pause / Replay / Next to the horizontal center of the entire Now Playing panel, matching the marked X.
- Jump to seconds remains below the centered buttons in a separate row.
- The Control page uses versioned CSS and JS URLs to prevent cached styling from undoing the layout.

fKey Playback is a local OBS / 24-7 YouTube station made by **fKey Labs Inc.** This is a **local-station production candidate**, not a guarantee of uninterrupted YouTube streaming.


## Previously in v1.0.5 — Browser opens automatically

- Double-click **`start-player.bat`** on Windows. Playback waits until its backend has started successfully, then automatically opens your default browser to the operator dashboard at `http://127.0.0.1:4177/control`.
- `start-player.sh` also opens the dashboard for interactive macOS/Linux desktop users. On headless Linux, Playback runs without trying to launch a browser.
- The launch operation does **not** open the OBS `/player` page, preserving one authoritative playback worker.
- `npm start` and Windows task-scheduler supervised starts remain browser-free. Set `PB_OPEN_BROWSER=0` before launching to opt out.
- The default browser is controlled by your operating system; opening it is best-effort. If it does not open, use the dashboard URL in the server console.

## Previously in v1.0.6 — Initial transport grouping

- Added a dedicated transport section between the playhead and volume controls. This release corrects the horizontal placement to match the full Now Playing panel.

## Previously in v1.0.4 — Volume and mute

- **Volume 0–100%**, **Mute / Unmute**, and a level indicator are now included below the seek bar in the operator dashboard.
- This controls the active YouTube iframe in OBS; adjustments follow the next video and survive shutdown/restart.
- Mute retains the chosen level, and slider changes unmute automatically when the value exceeds zero.
- The volume slider is keyboard and pointer accessible. Rapid changes are coalesced to limit disk writes while adjusting audio.
- The **OBS Audio Mixer fader is separate**; keep the Browser Source audio enabled. Live OBS integration still requires testing on your station.

## Previously in v1.0.3 — Sidebar and seek-bar repair

- Dashboard and Settings now label the sidebar **Playback**, alongside the official logo and the credit **made by fKey Labs Inc.**
- The operator dashboard again has a full-width playback seek bar beneath Now Playing. Drag the thumb, click anywhere on the track, or press Left/Right arrows while focused. The current time and total duration are shown above the bar.
- Seeking is disabled during voting or until YouTube supplies the duration; the existing **Jump to seconds** input remains available for exact seeking. The seek bar remains mounted while the station refreshes, so it won't interrupt an active drag.
- Seeking updates the server-authoritative playhead and resumes from that position in the OBS browser source. State remains persisted across restarts.

## Also included from v1.0.2

- Replaced the temporary placeholder brand icon with the official uploaded fKey Playback logo.
- Updated the Control page, Settings page, Viewer Voting page, auth screens, and browser tab icon to use the official logo.
- Retains the v1.0.1 YouTube title-recovery improvements and all prior playback fixes.

## Also included from v1.0.1

- Real YouTube video titles now appear in the OBS lower third, dashboard, queue and voting choices after a background metadata lookup or when the playing YouTube iframe reports its title.
- Recovered titles persist across shutdowns and restarts. Custom titles remain unchanged.
- Title ticker remeasures long titles on resizes and when the lower third reappears.
- If YouTube restricts metadata, the video ID remains a fallback and the operator can supply a title manually.

## Highlights

- Durable playback state, current video ID, queue, progress, votes and restart recovery.
- OBS Browser Source at `http://127.0.0.1:4177/player`, separate from operator controls.
- Operator dashboard at `http://127.0.0.1:4177/control` with token-based access.
- Customizable lower third (position, size, top/bottom anchors), theme colors,
  tabbed settings, title marquee, and best-effort caption hiding.
- Editable 2 × 2 end-of-video vote screen, optional Twitch chat reader,
  vote-to-skip and moderated requests.
- Windows, Linux, macOS launchers; Node.js 22.13+; no npm dependencies.

## Download and install

1. Download `Playback-v1.0.7.zip` below and extract into a dedicated folder.
2. Install Node.js 22.13 or newer.
3. On Windows run `start-player.bat`, on Linux/macOS run `./start-player.sh`.
4. The dashboard opens automatically after the server starts. Sign in with the token in
   `data/admin-token.txt`, and configure your video queue and Twitch channel.
5. Add an OBS Browser Source using `http://127.0.0.1:4177/player` and size 1920x1080.

## Notes before streaming

- Test live OBS, YouTube IFrame and Twitch network behavior on the target station.
- Twitch anonymous IRC is unofficial and may stop working; never assume official support.
- This local server is not designed to be internet-exposed, and community browser
  voting identities are not hardened against multiple accounts.
- Migrating state from the earlier v0.14 prototype is **best-effort only**.
  Back up your original `data/` before upgrading and validate the import.
- Use YouTube content only when you have the necessary streaming/rebroadcast rights.

See README.md for the full setup and limitations. MIT-licensed source is available
in this repository; fKeyLabs marks remain subject to trademark rights.