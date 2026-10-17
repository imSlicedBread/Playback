# fKey Playback v1.3.1 — Bulk queue move progress

The Smart Rotation Queue can now move selections larger than 500 videos automatically. The control dashboard splits a selected move into batches of 250, waits for each confirmed server commit, and reports moved/total counts, a percentage bar, batch count, errors and safe cancellation.

- **Select all matching** selects all videos in the active lane matching the current search, across every page. It does not select just the 50 visible rows.
- A move of 1,702 videos is seven batches (six batches of 250 plus the remaining 202), each committed before progress advances.
- If a batch fails or you stop, previously committed batches remain moved. Unconfirmed videos stay selected; choose **Move Selected** to retry after resolving any error.
- Queue rows and selected destination stay usable during regular polling. Playback and OBS are not paused by the move UI.
- The server retains its safety limit of 500 IDs per request, separate from the total library capacity, and the move engine now avoids quadratic per-entry searches.
- The SQLite storage upgrade from v1.3.0, uncapped rotation library, paginated dashboard, and bundled Windows yt-dlp are retained.

## Upgrade

Stop Playback, including the Windows startup task if configured, and back up the entire `data/` directory. Extract this release while keeping `data/` and `tools/`, then restart. Refresh the dashboard with **Ctrl+F5** once to bypass stale JavaScript. The existing `playback.sqlite3` remains compatible: no database migration or playlist reset is needed.

The official GitHub Windows package includes SHA-256-verified `yt-dlp.exe`. Live OBS/YouTube operation and the client's original workload still require an on-device acceptance test.

---

# fKey Playback v1.3.0 — SQLite storage and uncapped rotation queues

## Changes

- Removed the fixed total queue capacity, including the old 2,000-entry cap and queue truncation on startup. All four rotation lanes support larger libraries.
- Replaced production JSON snapshot persistence with indexed SQLite row storage in `data/playback.sqlite3`.
- Playhead, pause, volume, mute and ordinary settings commits write only the small station-state record; unchanged queue rows are not rewritten.
- Catalog changes use transactional row updates. Stable ordering positions avoid rewriting the remaining queue when its first video completes.
- Automatic migration preserves legacy JSON and creates an exact-byte `state.before-sqlite-migration.json` backup before committing the import.
- Added `npm run backup` for a verified, consistent database snapshot and `npm run benchmark:storage` for reproducible measurements.
- Preserved the paginated 50-row dashboard, complete-lane search, compact polling, dropdown stability, voting and OBS controls.

## Verification

The local Node suite passed 101 tests, with one Windows-only test skipped on Linux (102 total). Storage tests import and reload 10,000 videos, preserve an almost 8,000-entry legacy station, roll back injected commit failures, recover after a forcibly killed process, and verify live database backups. A real HTTP test imports 3,000 videos in batches, adds beyond the former cap, exercises controls and checks restart recovery.

An offline Chromium check using a Python HTTP bridge to the real SQLite test backend verified login, paging, search for video 9,999, stable destination selection, moving, pause and seek with 10,000 entries. Only 50 queue rows were mounted. Direct Chromium loopback navigation was blocked by the build environment, so this is not a live YouTube/OBS browser test.

At 10,000 videos in a synthetic local-disk benchmark, median checkpoint time was approximately 4.82 ms with the old JSON adapter versus 0.39 ms with SQLite; SQLite serialized 1,197 bytes and changed zero catalog rows per ordinary checkpoint. Catalog mutations and cold starts still perform work proportional to library size; see `BUILD-REPORT.md` and `STORAGE.md` for measurements and limitations.

## Upgrade — back up first

Stop Playback, including the Windows startup task if active. Back up the complete `data/` folder. Extract this release into the permanent installation while retaining `data/`, `tools/` and any local launcher configuration, then restart. The first start migrates JSON automatically. Refresh the dashboard and OBS source once after upgrading. Reinstall startup tasks only if the install location changes.

After migration, `playback.sqlite3` is authoritative. The old JSON is not kept up to date. Use `npm run backup` for a live backup or stop Playback before copying the full data directory. Never copy only a live SQLite main file or mix a restored database with unrelated WAL/SHM files. Older releases cannot read the new database: rollback requires the pre-upgrade directory backup and loses changes made after migration.

No fixed total queue limit is imposed. Safe per-request limits remain (300 pasted videos, 500 playlist entries, 500 bulk moves), along with the 200-request moderation inbox and recent-history retention. 10,000 is the tested library size, not a new cap or a hardware-independent performance guarantee.

The official Windows release continues to bundle verified `yt-dlp.exe` and its licensing notices. A separately named source/update ZIP requires retaining the existing `tools/` directory. Node.js 22.13+ and an active OBS/browser source are still required.