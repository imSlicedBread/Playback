# Changelog

## [1.2.0] — 2026-10-16

- Added durable Play Next, Upcoming, Recycled and Next Rotation lanes with automatic rollover.
- Preserved old queue/playhead during schema v1 to v2 migration, with a pre-migration backup.
- Integrated lane-aware OBS voting, history, play-next/now, moving, bulk actions, sorting, shuffle and importer destination controls.
- Added a prebundled, checksum-verified official yt-dlp.exe to Windows GitHub release ZIPs, with third-party notices and source links.
- Added rotation/voting/restart/security and bundle packaging tests.


## [1.1.0] — 2026-10-16

- Added authenticated YouTube playlist URL extraction and selectable preview.
- Import up to 500 playlist entries per batch in playlist order, with a start index for larger playlists.
- Added duplicate suppression for videos already playing, in the queue or repeated in a playlist.
- Added Copy Selected URLs and Export Selected CSV actions, with spreadsheet formula injection hardening.
- Added bounded `yt-dlp` metadata extractor (no API key), with official YouTube Data API v3 alternative.
- Added timeouts, URL validation, extraction concurrency limit, ephemeral previews, and atomic queue imports.
- Preserved the current video/playhead and preexisting settings.


## [1.0.9] — 2026-10-16

- Added independent OBS lower-third visibility switches for channel label, “NOW PLAYING”, duration and skip counter.
- Defaulted to a compact title-only lower third, retaining old positioning and color settings.
- Added a 50–300% video-title text-size slider, separate from whole-overlay scaling.
- Matched live editor preview and OBS output rendering, including collapsed rows and long-title ticker refresh after settings changes.
- Validated settings at the API boundary, checkpointed changes across restarts and added new automated regression tests.


## [1.0.8] — 2026-10-16

- Added unattended Windows AtStartup scheduled task running as LOCAL SERVICE, not SYSTEM.
- Added installer, uninstaller, status helper, and headless boot entrypoint with bounded persistent logs.
- Added optional dashboard opener at Windows sign-in, health-gated to avoid duplicate /player instances.
- Retires the previous sign-in-only fKeyLabs Playback task when boot startup is installed.
- Added startup tests and Windows PowerShell script syntax checks.


## v1.0.7 — transport placement correction

- Centered Previous / Pause / Replay / Next horizontally at the specified X, across the full Now Playing panel.
- Kept Jump to seconds in a separate row and added versioned dashboard CSS/JS assets to avoid stale styles.

## v1.0.6 — automatic dashboard browser opening

- Restored automatic default-browser launch of the operator dashboard when starting the interactive Windows batch launcher.
- Added macOS/Linux interactive launcher support with headless Linux detection.
- Open the dashboard **only after the server binds**, using the actual listening port; do not open the OBS player or create a second playback worker.
- Preserve unattended startup via `ops/start-player-supervised.bat` and `npm start` without launching a browser.
- Support `PB_OPEN_BROWSER=0` to disable automatic opening; browser-launch failure never terminates the server.
- Added cross-platform launch command, opt-in, failure and launcher-configuration tests.

## v1.0.4 — YouTube volume and mute controls

- Added a **0–100% YouTube volume slider** and **Mute / Unmute** button directly below Now Playing's seek bar.
- Persisted volume and mute independently of video playback, settings edits and queue state; restored them after restarting.
- Connected volume and mute to the OBS source's official YouTube IFrame API (`setVolume`, `mute`, `unMute`).
- Added operator authorization and strict volume validation, plus HTTP integration, persistence, YouTube API and offline Chromium tests.
- Preserved the official Playback logo, interactive seek bar and automatic YouTube title recovery.

## v1.0.3 — sidebar cleanup and interactive seek bar

- Removed redundant “fKey” from the sidebar label; the official f-keycap logo and the company credit remain.
- Restored the draggable, clickable, keyboard-accessible seek bar in the operator dashboard with elapsed and total time.
- Prevented polling updates from interrupting an in-progress seek operation.
- Retained precise jump-to-seconds, the saved playhead, title metadata recovery, and OBS output synchronization.


## v1.0.2 — official logo update

- Replaced the placeholder brand icon with the official fKey Playback logo provided by the project owner.
- Updated Control, Settings, Viewer Voting, auth screens, and browser tab icons to use the official logo.
- Version bump for a fresh GitHub release.


## [1.0.1] — 2026-10-16

- Fixed missing YouTube titles in the OBS lower third when a video was added by URL alone.
- Added best-effort, bounded YouTube oEmbed metadata lookup for the queue and viewer requests, requiring no YouTube API key.
- Enabled the active YouTube iframe to report its loaded title with its video ID and playback generation, protecting against stale/wrong-video titles.
- Persisted recovered titles in the video library, vote cards and history across restarts while preserving manually entered titles.
- Remeasure long-title scrolling after lower-third visibility changes and browser resizes.
- Updated branding to **fKey Playback**, made by **fKey Labs Inc.**


## [1.0.0] — 2026-10-16

Initial GitHub release of the standalone Playback broadcast-station implementation.

### Added

- Local OBS YouTube playback with a dedicated browser-source player.
- Durable queue, position, history and voting checkpoint recovery.
- Operator token authentication, origin checks and scoped worker leases.
- Queue playback controls and moderated video suggestions.
- 2 × 2 end-of-video vote screen, Twitch IRC votes and skip commands.
- Tabbed settings, custom colors, scrolling titles and CC suppression attempts.
- Lower-third drag/resize, top/bottom anchoring and output layout acknowledgements.
- Windows launcher, service-supervision helpers, Linux/macOS launcher and health endpoint.
- Automated syntax, integration and state-machine tests.

### Validation caveat

17 automated tests passed in the initial development build. The YouTube IFrame,
real Twitch chat, and OBS browser rendering still need live verification on the
deployment machine. The application is intended for a local streaming station,
not as a publicly accessible web service. Do not assume uninterrupted playback
without a running browser-source worker.