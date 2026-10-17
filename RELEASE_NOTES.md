# fKey Playback v1.2.4 — Large-queue control panel performance

## Changes

- The Smart Rotation Queue now renders **50 videos per page**, rather than mounting every row and thumbnail. Search covers the entire selected lane. Previous/next page controls show the position and total count.
- Selection survives page navigation. **Select this page** selects only displayed entries; **Clear selection** resets it. Bulk moves retain the existing 500-entry limit. Queue row IDs, dropdown selections during polling, and absolute reorder positions are preserved.
- The dashboard uses a compact live snapshot. The catalog (four rotation lanes, history and suggestions) transfers once on load and again only after it changes. A fresh server epoch invalidates cached catalog data after restart. Normal playhead, volume and settings updates do not resend the queue.
- OBS, viewer and Settings pages no longer download full queue lists on every poll.
- Refreshes are serialized and coalesced, with a timeout and no automatic polling while the dashboard is hidden. Switching back requests fresh state. OBS playback remains independent of dashboard visibility.
- Now Playing, idle vote cards, suggestions and theme colors no longer rebuild on every unchanged poll. Thumbnail loading is lazy and decoding asynchronous.
- Metadata scheduling scans the catalog once instead of once per video ID. Durable JSON snapshots are compactly encoded, retaining fsync, atomic replacement and previous-snapshot recovery.

## Verification and limitations

The local Node suite passed **88 tests**, with **one Windows-only test skipped on Linux** (89 total). An additional offline Chromium test connected to the real local backend through a test bridge verified paging, selection, search, absolute reordering, move, pause, seek, volume, mute, dropdown stability and single-flight requests with **2,000 videos**.

In an offline Chromium benchmark with 4x CPU throttling and synthetic metadata, median dashboard refresh work went from **43.7 ms to 5.0 ms at 350 videos**, and **113.1 ms to 4.2 ms at 1,000 videos**. Steady poll payload at 350 videos fell from **186,056 bytes to 1,495 bytes**. See `PERFORMANCE.md` for methodology and qualifications. These are test results, not a guarantee of client hardware performance.

This is an initial optimization pass, not a streaming/encoding benchmark. The full catalog is still transferred after queue mutations. The existing 2,000-entry capacity and synchronous durable state saves remain; particularly slow storage and heavy concurrent media workloads need on-device testing.

## Upgrade

Stop Playback (including its Windows startup task if running) and back up the complete `data/` directory. Extract the new release, restore the saved data and restart. Refresh the dashboard and OBS Browser Source once to load the compact-poll clients. No data-schema migration or playlist reset is required. Reinstall Windows startup tasks only if the install path changes.

The official Windows release workflow continues to bundle checksum-verified `yt-dlp.exe` and third-party notices. A separately labeled source/update ZIP does not bundle this binary: retain your existing `tools/` directory when using it. Playback still needs Node.js and an active OBS/browser player for video output.
