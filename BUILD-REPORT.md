# fKey Playback 1.2.4 — Build and verification report


## Environment

Linux build container, Node.js 22.16.0, headless system Chromium, 1440 × 1000 viewport, **4x CPU throttling**. Queue fixtures contain one current video and the remaining entries in Upcoming, with a realistic long title. The client capacity remains 2,000 entries across active + queue lanes.

The offline browser test injects the shipped HTML/CSS/JavaScript without changing rendering functions. Imports are concatenated for testing only. External thumbnails are replaced by a uniform local SVG; YouTube, Twitch, OBS and real network decoding/encoding are not part of the timings. A native browser network policy prevented normal HTTP navigation in this environment, so DOM tests use an offline page. Separate interaction tests bridge that page to the real localhost HTTP server for authenticated actions.

## Before / after (same benchmark harness)

| Videos in station | v1.2.3 mounted queue rows | v1.2.4 mounted queue rows | v1.2.3 DOM elements | v1.2.4 DOM elements | v1.2.3 median refresh | v1.2.4 median refresh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 350 | 349 | 50 | 6,520 | 1,148 | 43.7 ms | 5.0 ms |
| 1,000 | 999 | 50 | 18,220 | 1,148 | 113.1 ms | 4.2 ms |
| 2,000 | Not completed | 50 | Not recorded | 1,148 | Not recorded | 4.7 ms |

Each refresh figure is the median of five manual refreshes, including parsing the actual engine-generated JSON snapshot (delivered by the in-page test stub) and forcing pending layout. There are also eight unchanged-queue render samples. This is **not end-to-end input latency or a real-network latency benchmark**. The 2,000-entry baseline run did not complete within the command window and is not reported as a measured crash/failure. No before/after speedup is claimed for that case. Initial load measurements include test setup and should not be interpreted as production navigation time.

| Videos | v1.2.3 recurring operator JSON | v1.2.4 unchanged-catalog JSON |
| --- | ---: | ---: |
| 350 | 186,056 bytes | 1,495 bytes |
| 1,000 | 530,556 bytes | 1,495 bytes |
| 2,000 | Not recorded in the baseline run | 1,497 bytes |

The optimized first response still includes the full catalog once. The compact snapshot stays independent of queue size during playback-only updates. Queue mutations, discovered titles, history/suggestion changes and a server restart invalidate the catalog and send fresh data. No queue items are deleted to reduce payload size. Small byte-count variations depend on video titles, settings, active vote counts and output clients.

## Verified behavior

- 89 Node tests: **88 passed, 0 failed, 1 Windows-only skip on Linux**.
- With 2,000 videos, only 50 queue rows are mounted.
- Selections survive page changes; the previous page remains checked.
- Searching finds an entry outside the visible page; reordering uses its absolute lane index.
- Selected dropdown destination and its DOM node survive ordinary polling.
- Move, Pause, Seek, Volume and Mute update the real backend through authenticated HTTP.
- A burst of twelve dashboard refresh calls never overlaps operator requests.
- No JavaScript errors in the Chromium interaction check.
- Restart invalidation, failed-write rollback, catalog metadata recovery, legacy full endpoints and data-schema compatibility have regression coverage.

Raw result files are included under `test/performance-results/`. The optional offline browser profiling harness is `ops/profile-control-panel.py`; it needs Python Playwright and a local Chromium executable, not additional application runtime dependencies.

## Still to validate / next bottlenecks

The client's precise machine, browser trace and storage characteristics were not available, so the exact customer failure has not been reproduced. These changes address measured scaling costs in the existing implementation. On-device acceptance should include actual OBS playback, the client's playlist, background CPU/memory, a sustained session, media changes and restart recovery. The snapshot writer is still synchronous and fsyncs every committed change; the update does not trade away persistence for speed. A future pass can separate playhead checkpoints from catalog persistence or use a database after crash-recovery testing. Catalog updates still send all metadata after structural changes, and the 2,000-entry limit has not been raised.
