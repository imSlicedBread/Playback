# Memory and browser crash investigation — October 28, 2026

The reported failure followed 135 hours of normal operation. Its original cause remains unconfirmed without the affected OBS log. A simulated uptime test does not reproduce real multi-day resource use.

## Findings and changes

- The station retained expired output acknowledgement IDs indefinitely even though status responses hid them. Expired records are now deleted; live acknowledgements are capped at 256.
- Title lookup caches and attempted-ID history grew with every unique video ever processed. Both are capped at 5,000; saved queue titles remain intact, pending/in-flight lookups remain deduplicated, and shutdown releases cached entries.
- Browser-to-Qt callbacks now use the browser widget as their cancellation context. Browser-owned deadline timers cannot post more CEF work after close. An unused full request-event capture was removed, and Chromium diagnostic network buffers are bounded to 1 MiB.
- Capture textures are reused and freed on stop/destroy. Audio capture releases packet buffers, COM owners and event handles, and joins its owned thread. Inspection found no obvious unbounded collection in those paths; this is not proof against external driver/Chromium leaks.
- Renderer termination now clears stale interception callbacks and signals the operator layer. Playback recreates only its browser in the same global account context, at the saved station checkpoint, with the same output HWND/size and normal paused/voting controls. It shares the existing three-retries-per-five-minutes limit; Stop invalidates delayed retries. It does not restart OBS or unrelated sources.
- Whole-OBS private/working memory, handles and pending HTTP counts are logged every five minutes during playback. Renderer exit codes are logged separately. Account credentials and ordinary chat are not included in these new diagnostics.

## Measured fixture result

A real CEF subprocess was deliberately crashed in an isolated temporary test profile. Crash notification and subsequent browser recreation retained the fixture account-context cookie. No live account or OBS source was touched.

The first successful 50-cycle browser churn run measured the test's owned process tree after warmup:

| Metric | Cycle 5 | Cycle 49 |
| --- | ---: | ---: |
| Private committed bytes | 74,612,736 | 76,460,032 |
| Handles | 2,724 | 2,736 |
| Process count | 8 | 8 |

This small increase is within the regression smoke-test budget; it does not establish zero leaks. The fixture uses synthetic video state, a loopback HTTPS server, and disabled GPU. It covers creation/closure and filtering lifetimes, not real decoder/video/GPU growth. The test also checks that owned child processes exit after CEF and the fixture server shut down.

## Remaining validation

A sustained signed-in YouTube run is still required, measuring OBS, browser renderer/utility processes, GPU memory and handles across real video transitions. Preserve the OBS log from the affected user's failure, including renderer exit/resource records from the updated build when available. Do not claim the reported 135-hour root cause is resolved from this fixture alone.

## Supplied OBS log findings

Three user-supplied logs were reviewed on October 28, 2026. No raw logs, account/session paths or scene identifiers are included here.

- `log1.txt`: OBS 32.2.2, Qt 6.11.1, obs-browser 2.26.9, compiled CEF 127.145.7 / Chromium 127.0.6533.120. The session lasts about 17 seconds and shuts down normally. It reports one tracked allocation remaining at shutdown, without an allocation site or growth measurements. Playback audio connected.
- `log2.txt`: OBS 33.0.0, obs-browser 2.27.4, compiled CEF 150.0.20 / Chromium 150.0.7871.252. It records browser-cookie/session migration to the newer Chrome runtime, then a normal shutdown after about 27 seconds. Shutdown reports zero tracked memory leaks. This browser runtime is incompatible with the current plugin's pinned CEF 127 ABI.
- `log3.txt`: OBS 33.0.0 / Chromium 150 again. Near the end, about 24 minutes after startup, it records two `Device Remove/Reset! Rebuilding all assets...` events at 08:08:38 and 08:08:40. These establish graphics-device resets, not their cause or attribution to Playback.
- The YouTube sandbox-script warning is tagged as the separate OBS source named `Browser`; it does not establish a fault in the native Playback browser.

These logs explain a runtime rejection after the move to OBS 33, but they do not capture the reported 135-hour session. There is no recorded out-of-memory or renderer-termination event establishing its cause. The old plugin also lacked the new crash/resource diagnostics, so the absence of those records cannot rule out a renderer failure. Obtain the original long-running session log or crash report to investigate that event. Keep the ABI guard; do not load CEF 127 native interfaces against CEF 150 or replace individual OBS runtime DLLs.
