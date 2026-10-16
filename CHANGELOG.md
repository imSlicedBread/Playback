# Changelog

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