# fKey Playback v1.2.3 — Build and verification report

## v1.2.3 — Rotation Queue move dropdown regression

- `npm run check`: passed.
- `npm test`: **77 passed; 0 failed; 1 Windows-only test skipped** in Linux (78 tests total).
- New regression tests verify stable row-key reuse, no replacement of active select nodes, changing action indices, and versioned dashboard assets.
- Headless Chromium: opened a native queue Move `<select>`, kept it focused through >3 seconds of dashboard polling, changed to **Next rotation**, waited another >2 seconds while polling, and confirmed the same DOM node remained mounted with the chosen destination preserved. Updated title/play-count metadata live without remounting. Pressing **Move** submitted `nextRotation`, and the video moved to that lane. No JavaScript errors.
- The queue server state machine and persistence are unchanged; only dashboard DOM reconciliation/versions were modified.
- GitHub's official Windows release workflow continues to bundle yt-dlp.exe after SHA-256 verification. The local source-only ZIP does not contain the third-party executable.
- Live OBS/YouTube/Twitch operation still requires on-device verification.


## Lower Third opacity and height verification

- Node.js syntax validation: passed (`npm run check`).
- Node tests: **74 passed / 0 failed / 1 Windows-only PowerShell test skipped locally** (75 tests total); includes seven new tests covering old-state defaults, strict height/opacity validation, frame bounds, saved-state recovery, shared preview/OBS style computation, editor controls, and authenticated API propagation.
- Offline Chromium interaction check (actual Chromium browser rendering, isolated from network): 1600, 1250, 800 and 480px viewports all retained 16:9 canvas ratio and had no JavaScript errors. The inspector sits alongside the canvas on large viewports and stacks below it on narrow ones.
- Offline Chromium pointer test: diagonal drag of the bottom-anchored top-right handle updated both width and height; Auto Height reset and live opacity/height style updates passed.
- End-to-end live OBS rendering was not available in this environment. Chrome's managed network policy blocked navigation to the local HTTP server, so browser checks used isolated DOM/CSS/JS rendering; API and restart persistence were verified separately with live HTTP tests.
- Release archive and source contents are rechecked after packaging. GitHub Actions verifies Windows and Ubuntu checks and bundles upstream yt-dlp for the Windows release.

# fKey Playback 1.2.1 — Build and verification report

## 1.2.0 validation

- Full Node.js syntax and test suite run against the extracted package.
- Rotation tests cover v1.1 migration, durable current playhead, new-before-recycled ordering, automatic rollover, deferred next rotation, play now/interrupted playback, queue move/reorder/sort/shuffle, vote eligibility, unavailable videos and API authorization.
- GUI queue tabs and playlist importer destinations use server-owned lane state.
- Official GitHub Actions release downloads yt-dlp v2026.08.19 from its release, verifies a pinned SHA-256 and ships the upstream licensing files. Windows CI also runs `yt-dlp.exe --version`.
- Local container network is restricted; local development source ZIP does not include the external binary. Only the GitHub release workflow can supply it. Do not label source archives prebundled.
- Live YouTube/OBS connectivity and actual Windows boot startup require on-device checks.

**Release target:** Local Windows OBS broadcasting station; portable Node.js 22.13+ distribution.

## 1.1.0 playlist importer verification

- Full build passed `npm run check` and `npm test` locally and from a fresh extracted ZIP.
- Historical 1.1.0 ZIP: `yt-dlp` was not bundled; starting in 1.2.0 the official Windows ZIP includes it.
- Offline Chromium rendered a representative playlist preview at 1440px with URL input, options, selectable rows, copy/export controls and import button.

- New tests cover URL validation, provider output normalization, yt-dlp argument safety, YouTube Data API pagination, authenticated extraction/import, selected video ordering, deduplication, and restart preservation.
- Historical 1.1.0 release did not include yt-dlp. From 1.2.0 forward, the Windows CI checks the bundled exe and the GitHub release includes it.

## 1.0.9 implementation verification

- New lower-third options are validated, persisted atomically, restored on restart and returned through the public OBS state API.
- Both Settings preview and OBS output use `applyLowerThird` for hide/show and independent title sizing.
- Title-only default collapses empty header/footer rows without blank space; ticker remeasures on layout revisions.
- Isolated headless Chromium rendered title-only and mixed-label overlays, confirming collapsed rows and enlarged title size.
- Live YouTube iframe playback, OBS audio routing and actual Windows boot behavior still require acceptance testing on the target PC.

## v1.2.1 QA — playlist reset and anchor alignment

- `npm run check`: passed.
- `npm test`: **68 passed, 0 failed, 1 Windows PowerShell parsing test skipped** on Linux; 69 tests total.
- New unit regression tests exercise importer reset and preference retention, success-only reset behavior, responsive lower-third structure and asset versioning.
- Headless Chromium smoke test: extraction preview, failed-import retry state, successful-import cleanup, and immediate extraction of a second playlist; JavaScript errors: none.
- Headless Chromium responsive check: anchor selector and three buttons align by their bottom edges at **1600, 1200, 760 and 500px** viewports.
- Release packaging verified from a clean extracted source-only ZIP. Official Windows release includes SHA-256 verified `yt-dlp.exe` through the GitHub release workflow.
- Actual YouTube and OBS integration still needs an on-device smoke test; no live YouTube network extraction was performed here.

## Executed checks

- **Windows boot startup:** uses `New-ScheduledTaskTrigger -AtStartup` with a restricted `NT AUTHORITY\LOCAL SERVICE` principal and explicit write access to `data/`, not the program files.
- Added an optional dashboard AtLogOn task, boot-service lifecycle logging, automatic restart configuration, idempotent install and removal scripts.
- New automated checks validate script invariants and a real headless Node startup/HTTP health endpoint; Windows CI additionally parses the PowerShell scripts.
- A real task registration, machine reboot and OBS startup must be acceptance-tested on the target Windows streaming PC.

- `npm run check` — validated syntax of backend and all client-side JavaScript modules.
- `npm test` — current results above; historical earlier tests were 53 passed.
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

## Automatic browser-opening verification

- Five new unit tests verify that the Windows launcher opts in, the browser command opens `/control` only (never OBS `/player`), actual server ports are used, and macOS/Linux commands are platform-specific.
- Headless Linux skips browser launching. A browser-launch error is handled as non-fatal, preserving server uptime.
- The Windows supervised autostart helper does not opt in, so unattended restarts do not open browser tabs.
- **Actual default-browser launching on a graphical Windows installation must be confirmed on your machine**, because the build environment is not an interactive Windows desktop.

## Restrictions and remaining acceptance tests

- This implementation was rebuilt from the project requirements; the complete former `playback-v0.14-settings-tabs.zip` source was not extractable. Test state migration against your actual v0.14 archive before relying on it; keep a complete backup.
- A headless Chromium attempt to open the local UI in the build environment was blocked by administrator browser network policy. Automated HTTP requests and offline Chromium DOM rendering succeeded. **Live YouTube IFrame, Twitch network and OBS-rendered output were not end-to-end verified**.
- Confirm on an actual OBS computer that YouTube autoplay is allowed, captions default off where supported, bottom/top anchors dock correctly at 1920 × 1080, and the output acknowledges updated layout. Test at least one complete end-vote-transition cycle and abrupt restart.
- Twitch anonymous IRC is an unofficial best-effort service. For a hardened public-facing product, add official Twitch EventSub authorization/token refresh and strong authenticated public voter identity, external monitoring and a controlled HTTPS deployment.

The release should be treated as a **local-station production candidate**, not as a certified uninterrupted public broadcast appliance.

## v1.0.7 visual layout verification

- Offline Chromium confirmed the transport-button cluster is centered to within **0 CSS px** of the full Now Playing panel midpoint at viewport widths 1440, 1034, 700 and 390 pixels.
- Confirmed Jump to seconds remains a separate row beneath the buttons in all four layouts.
- Dashboard stylesheet and script URLs use the v1.0.7 version query, bypassing the previous five-minute asset cache.
- Two additional automated tests check markup order, full-width CSS centering, separate jump row, and versioned assets.