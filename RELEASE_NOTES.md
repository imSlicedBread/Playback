# fKey Playback v1.5.1 — Windows startup and OBS recovery

This update improves unattended startup after a Windows reboot and helps the OBS player recover when YouTube is not ready during startup.

- **Optional OBS startup:** the Windows installer can register OBS to open at sign-in after Playback's backend is healthy. It opens the dashboard first and avoids starting another OBS process when one is already running.
- **Remembered dashboard login:** check **Keep signed in on this computer for 30 days** when logging in. A signed HttpOnly cookie survives browser and server restarts; the operator token is not stored in browser storage or startup URLs. Logging out, clearing cookies, private browsing or expiration requires another login.
- **Player recovery:** retry failed YouTube API/iframe startup and unstarted video loading. Preserve saved resume positions and intentional pauses, ignore callbacks from replaced iframes, and avoid quarantining videos for transient HTML5 startup errors.
- Existing Twitch, Kick and SOOP connections, queues and SQLite data remain compatible. No database schema migration is required.

## Upgrade and one-time startup setup

1. Stop Playback and back up the complete `data/` directory. Extract this release while preserving `data/`, `tools/` and launcher configuration. Node.js **22.13 or newer** is required.
2. Run **INSTALL-AUTO-START.bat** again, choose whether to start OBS, and approve the administrator prompt. Playback must be in a permanent local folder outside the user profile, with Node installed for all users. Custom OBS paths are supported by the PowerShell installer; see the [startup instructions](https://github.com/imSlicedBread/Playback#windows-automatic-startup).
3. Sign in once using the remembered-login checkbox in your usual browser profile at `http://127.0.0.1:4177/control`.
4. Keep the OBS Browser Source active at `http://127.0.0.1:4177/player`, with **Shutdown source when not visible** disabled. Disable **Refresh browser when scene becomes active** for continuous playback. Remove a duplicate OBS Windows startup entry if using Playback's OBS launch option.
5. Restart Windows to validate your workstation. The backend starts before sign-in; **OBS and the browser require Windows desktop sign-in**. Playback does not configure Windows automatic sign-in or start OBS streaming/recording.

All **141 automated tests** and JavaScript syntax checks pass locally on Windows, including simulated startup timing, persistent login across a real backend restart, and player recovery. Actual workstation reboot/OBS acceptance remains required. Live Kick/SOOP validation also remains pending. The release ZIP includes checksum-verified yt-dlp and a SHA-256 checksum file.

---

# fKey Playback v1.5.0 — Kick and SOOP admin chat

Kick and SOOP now have independent admin chat readers under **Settings → Chat Connections**. Each reader starts disabled with an empty, private whitelist. Explicitly allowed platform accounts can use the existing playback, audio and video-adding commands. Broadcasters and moderators receive no automatic access.

- Kick uses a read-only Pusher connection. Configure the channel and whitelist; a manual numeric chatroom ID is available when channel lookup is blocked.
- SOOP uses an independent Playback OAuth connection. Configure your own SOOP application credentials and approved `broad_access_chatinfo` scope, then run `npm run connect:soop`. The callback is local to `127.0.0.1:4180`; tokens and refresh rotation stay in the local data directory. The authorized broadcast must be live.
- All three readers share the station command budget and latest-20 activity list. Access uses platform-specific sender identities. Public snapshots exclude whitelists and credentials.
- Twitch viewer votes, skip votes and requests retain their behavior. Kick/SOOP add admin commands only. No chat replies or moderation messages are sent.
- Reconnect controls, connection status and Settings draft preservation are included. Older dashboard clients preserve the new settings when saving unrelated changes.

## Upgrade and setup

Stop Playback and back up the complete `data/` directory. Extract this release while preserving `data/`, `tools/` and launcher configuration, then restart and refresh dashboard/player pages. Node.js **22.13 or newer** is required. No database schema migration or queue reset is needed. See the [README setup instructions](https://github.com/imSlicedBread/Playback#kick-and-soop-admin-chat-readers) for provider configuration.

All 135 automated tests and JavaScript syntax checks pass locally on Windows. Automated acceptance uses simulated provider traffic, including identity checks, malformed messages, reconnection, OAuth renewal, command dispatch, persistence and Settings behavior. Kick's transport is unofficial; SOOP implements the receive-only protocol checked against fStream's pinned official SDK. **Live Kick/SOOP validation in Playback remains pending** and requires a configured channel and an authorized SOOP account. The Windows ZIP includes the checksum-verified yt-dlp bundle.

---

# fKey Playback v1.4.0 — Twitch chat admin whitelist

Selected Twitch users can now control playback and add videos directly from chat. Configure their usernames under **Settings → Twitch Chat → Chat Admin Whitelist**, then click **Save Settings**. The list starts empty and is visible only to authenticated dashboard operators. Broadcasters and moderators must also be explicitly listed.

- Playback: `!pause`, `!resume`, `!forceskip`, `!previous`, `!replay`, `!seek SECONDS`.
- Audio: `!volume 0-100`, `!mute`, `!unmute`. Unmuting at zero restores volume to 50.
- Video adding: `!add URL`, `!playnext URL`, `!playnow URL`, also accepting video IDs and optional ` | Display title`. Play Now parks the interrupted video to resume next.
- Viewer `!skip` remains a skip vote. Viewer requests still require approval. Chat commands cannot manage access or edit station settings.
- Commands require a numeric Twitch sender identity and origin in the configured channel. Duplicate message IDs and Shared Chat forwarding from other rooms are ignored.
- Allow two seconds between commands per account; the station accepts at most 30 per minute. Settings shows the latest 20 authorized command attempts and results. Activity clears on restart; no chat replies are sent.
- Saving access changes takes effect immediately. Existing queues, playback timestamps, overlay settings and SQLite storage remain compatible.

## Upgrade

Stop Playback and back up the complete `data/` directory. Extract this release while preserving `data/`, `tools/` and launcher configuration, then restart. Refresh dashboard and player pages once to load v1.4.0 assets. No database schema migration or queue reset is needed. Access follows usernames, including any later username ownership changes.

All 123 automated tests and JavaScript syntax checks pass locally on Windows. Tests simulate Twitch traffic through the real connector and exercise HTTP, persistence, rollback and Settings event handlers. Live Twitch/YouTube/OBS operation still requires testing on the streaming workstation. The official Windows ZIP includes the existing checksum-verified yt-dlp bundle.

---

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
