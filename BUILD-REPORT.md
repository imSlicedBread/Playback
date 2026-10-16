# fKey Playback 1.0.4 — Build and verification report

**Release target:** Local Windows OBS broadcasting station; portable Node.js 22.13+ distribution.

## Executed checks

- `npm run check` — validated syntax of backend and all client-side JavaScript modules.
- `npm test` — **30 tests passed; 0 failed**.
- HTTP integration tests — control/settings/vote/player routes load; operator endpoints reject unauthenticated writes; session token protects mutation; hostile origin blocked; worker leases enforce ownership; stale updates refused; layout revisions acknowledged; state survives process restart.
- State-machine tests — queue, seek/pause/previous/replay/skip, fault quarantine, end-of-video vote, same-viewer change, tie break, countdown pause during server downtime, setting validation and migration fallback.
- Twitch protocol tests — tagged and nickname fallback identity, strict !vote parsing, !skip and moderated !request commands.
- Referrer policy test — verifies a header compatible with YouTube IFrame API's embed identification requirements.
- Metadata tests — validate restricted oEmbed title lookup, current/queued-video title recovery, duplicate preservation, manual-title priority, stale iframe metadata rejection, and title persistence after restart.
- Offline Chromium DOM/CSS tests — the previously recovered-title marquee animates only for overflow. The operator dashboard slider is verified with native pointer clicks, prolonged drag spanning refresh intervals, and keyboard arrows. Server mutation works, the slider remains mounted during refresh, and the seek control disables during votes or before duration is known.

## New volume-control verification

- Authenticated volume/mute actions, validated integers 0–100, unchanged playback generation and layout revision, and persistence through full server restarts.
- Settings saves preserve audio selections without clobbering them, and older state files automatically initialize to 100% unmuted.
- Mocked YouTube IFrame calls assert the actual `setVolume`, `mute`, and `unMute` invocations and safe fallback behavior.
- Offline Chromium dashboard exercise confirmed slider input, mute/unmute, retained level and polling stability. Browser access to localhost was blocked by environment policy; **live OBS/YouTube audio still needs an on-device acceptance test**.

## Restrictions and remaining acceptance tests

- This implementation was rebuilt from the project requirements; the complete former `playback-v0.14-settings-tabs.zip` source was not extractable. Test state migration against your actual v0.14 archive before relying on it; keep a complete backup.
- A headless Chromium attempt to open the local UI in the build environment was blocked by administrator browser network policy. Automated HTTP requests and offline Chromium DOM rendering succeeded. **Live YouTube IFrame, Twitch network and OBS-rendered output were not end-to-end verified**.
- Confirm on an actual OBS computer that YouTube autoplay is allowed, captions default off where supported, bottom/top anchors dock correctly at 1920 × 1080, and the output acknowledges updated layout. Test at least one complete end-vote-transition cycle and abrupt restart.
- Twitch anonymous IRC is an unofficial best-effort service. For a hardened public-facing product, add official Twitch EventSub authorization/token refresh and strong authenticated public voter identity, external monitoring and a controlled HTTPS deployment.

The release should be treated as a **local-station production candidate**, not as a certified uninterrupted public broadcast appliance.