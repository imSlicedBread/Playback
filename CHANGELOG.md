# Changelog

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