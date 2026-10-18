# fKey Playback 1.5.1

Made by **fKey Labs Inc.** A persistent, local 24/7 YouTube station with an OBS Browser Source and a separate operator dashboard.

[Releases](https://github.com/imSlicedBread/Playback/releases) · [MIT license](LICENSE) · [Storage and migration](STORAGE.md) · [Security](SECURITY.md)

## New in v1.5.1 — Windows startup and OBS recovery

Choose optional OBS startup in **INSTALL-AUTO-START.bat**, keep dashboard login for 30 days, and recover automatically from YouTube startup failures. See [Windows automatic startup](#windows-automatic-startup) for the one-time setup and reboot check.

## New in v1.5.0 — Kick and SOOP admin chat

Connect Kick and SOOP independently under **Settings → Chat Connections**, with separate private whitelists and shared playback commands. Both readers start disabled. SOOP includes a local OAuth setup helper. See [setup and connection details](#kick-and-soop-admin-chat-readers).

## New in v1.4.0 — Twitch chat admin whitelist

Give selected Twitch usernames playback and video-adding commands from **Settings → Chat Connections**. The whitelist is private and empty by default. Command results appear in Settings; existing viewer voting and requests keep their behavior. See [Twitch chat admin whitelist](#twitch-chat-admin-whitelist) for commands and access rules.

## Large bulk queue moves — v1.3.1

The queue panel now includes **Select all in lane / Select all matching**, so operators can choose all 1,702+ videos with one click even though only 50 queue rows are rendered per page. Click **Move Selected** to move the entire selection, automatically processed in **250-entry durable batches**. A live progress bar reports confirmed moved/total, percentage and batch number. **Stop after current batch** cancels safely between server requests; batches already committed remain moved. Failed batches leave unconfirmed videos selected for retry. The server deliberately retains its 500-ID maximum per request, which is not a limit on how many videos can be moved in one dashboard operation. Avoid closing the browser while a bulk move is active. See `STORAGE.md` for persistence and backup details.

## New: SQLite storage and no fixed queue cap

The fixed 2,000-entry rotation-queue cap and startup truncation are removed. SQLite stores queue entries separately from playback state, so frequent playhead saves no longer rewrite a large JSON library. Tested with **10,000 videos**, while keeping the existing 50-row paginated dashboard and compact live polling.

Existing `state.json` installations migrate automatically with an exact pre-migration backup. The new database is `data/playback.sqlite3`; it becomes authoritative after migration. **Back up the complete data folder before upgrading.** Read [STORAGE.md](STORAGE.md) for migration, backup and rollback instructions. Do not copy only the database file from a running station.

## Start on Windows

1. Install Node.js **22.13 or newer**. There are no npm runtime dependencies.
2. Extract the complete release into a permanent directory such as `C:\Playback`.
3. Double-click `start-player.bat`. The dashboard opens after the server is ready.
4. Sign in with the operator token in `data/admin-token.txt`. Keep that file private.
5. Add videos or use **YouTube Playlist Importer → Extract Videos → Import Selected**.
6. In OBS, add a Browser Source using `http://127.0.0.1:4177/player`, width 1920 and height 1080. Keep the source active.

Linux/macOS: run `./start-player.sh` or `node server.js`. The official Windows ZIP bundles the pinned, checksum-verified `yt-dlp.exe`; Linux/macOS users should install their platform's yt-dlp and set `YT_DLP_PATH` if needed. Playlist extraction imports metadata, not video files. Optional `YOUTUBE_API_KEY` supports the official API extraction route.

## Pages

| Page | Address | Purpose |
| --- | --- | --- |
| Control | `http://127.0.0.1:4177/control` | Operator playback, search, paginated queues, imports and requests |
| Settings | `http://127.0.0.1:4177/settings` | Playback, chat connections, colors, lower-third and vote-screen editors |
| OBS source | `http://127.0.0.1:4177/player` | Video, title overlay and end-of-video voting |
| Clean OBS source | `http://127.0.0.1:4177/player?clean=1` | No lower third; voting screen remains available |
| Viewer portal | `http://127.0.0.1:4177/vote` | Local viewer suggestions and voting |

The server does not render/encode video by itself. OBS or an active player browser is required. Closing the Control tab does not stop a separate OBS player; disabling the player source does stop playback.

## Smart Rotation Queue

**Play Next** has priority. **Upcoming** contains unplayed/new videos. Completed or skipped videos enter **Recycled**, and explicitly deferred videos wait in **Next Rotation**. Once the playable queue is exhausted, deferred and recycled entries enter the following rotation. Offline time does not advance the saved video or voting countdown.

Owner actions include Play Now (parking interrupted playback), Play Next, moves between lanes, bulk move, reorder, sorting and shuffle. The UI shows 50 videos per page, not a 50-video library limit. Search covers the entire selected lane; selection can span pages.

There is no fixed total queue capacity. Per-action safety limits remain: 300 pasted videos, 500 playlist entries per extraction/import and 500 entries per server bulk-move request (the dashboard automatically batches larger selections). The pending-suggestion inbox is limited to 200 to prevent abuse, and recent history retains 300 events. These are not rotation-library caps.

## OBS appearance and controls

The dashboard includes a draggable seek bar, direct seek input, transport buttons, volume and mute. Settings support independent visibility for channel name, NOW PLAYING, duration and skip count; title-only display; title text scaling; top/bottom anchoring; card height and background opacity; and drag-to-resize editing. Long titles scroll only when needed. Caption suppression is best effort and cannot remove captions burned into video pixels.

The four-choice voting screen can be styled independently. Twitch commands are `!vote 1` through `!vote 4`, `!skip` and `!request URL`. Anonymous IRC reading is unofficial and may change; authenticated IRC uses `TWITCH_USERNAME` and `TWITCH_OAUTH_TOKEN` in the server environment. No bot chat messages are sent.

## Kick and SOOP admin chat readers

**Settings → Chat Connections** includes independent Kick and SOOP readers, each disabled with an empty whitelist by default. Their admin commands are the same as Twitch's list below; Kick/SOOP viewer votes, suggestions and chat replies are not added. Only the saved platform-specific whitelist grants access. Being a moderator or having the same username on Twitch does not grant access on another platform. Activity identifies the platform, and the 30-per-minute station budget is shared across all three readers.

**Kick:** enter the channel login and allowed account usernames, enable the reader, and save. The read-only Pusher/WebSocket transport follows fStream's live-tested adapter and requires neither OAuth nor a public webhook. It is unofficial and can change. If public channel lookup is blocked, enter the channel's numeric chatroom ID. Click **Reconnect Kick** after correcting connection settings. Only live chat events from the subscribed room and actual sender identities can execute commands; display names, old messages and duplicate message IDs cannot grant access.

**SOOP:** this is an independent connection to the current SOOP platform at `sooplive.com`, following the official SDK protocol used by fStream. It does not use fKey login, fStream's application credentials, or its backend. Configure it once:

1. Register your own application at [SOOP Developers](https://developers.sooplive.com/), register redirect **`http://127.0.0.1:4180/callback`**, and obtain approval for **`broad_access_chatinfo`**. This is SOOP's combined chat retrieval/sending scope; Playback uses it for reading and never sends chat messages or moderation commands.
2. Set **`SOOP_CLIENT_ID`** and **`SOOP_CLIENT_SECRET`** in the environment used to launch Playback and its setup command. Restart Playback if its launch environment has changed.
3. In the community app folder, run **`npm run connect:soop`** from that environment. Open the private localhost link printed in the terminal and authorize your SOOP account. The one-shot callback listener binds only to `127.0.0.1:4180` and closes on success or after ten minutes. No public listener or tunnel is required.
4. In **Chat Connections**, enter your broadcaster account login ID and the allowed SOOP users' login IDs (not nicknames), enable SOOP, and save. Start the authorized SOOP broadcast and click **Reconnect SOOP**. The account must have access to that live broadcast.

The setup tool saves tokens to **`data/soop-auth.json`**, or the corresponding `DATA_DIR`. The server renews access using your application credentials and preserves rotated refresh tokens locally. Client secrets and tokens are never returned by operator/public APIs. A pre-existing `SOOP_ACCESS_TOKEN` and optional `SOOP_REFRESH_TOKEN` can be supplied instead; environment token changes take precedence over cached credentials. Without refresh authorization, expired access requires reconnecting the account. Use the same `DATA_DIR` for setup and the station.

The SOOP reader implements only authenticated login, room join, keepalive, and public/manager-message receipt. Guest identities, nicknames, whispers, donation/VOD events, and wrong-room sessions do not grant admin access. It does not download or execute a remote SDK at runtime. Its handshake was compared byte-for-byte against fStream's pinned official SDK (`2026-10-02`, SHA-256 `8f89b163d29ddf885dd3de9cddba98b8446fe26c8b3d96483644f4acb47254a5`). Live Kick/SOOP acceptance testing in Playback remains necessary; fStream's live results are reference evidence, not a Playback live test.

## Twitch chat admin whitelist

In **Settings → Chat Connections**, enter allowed Twitch usernames separated by commas or newlines, then click **Save Settings**. Names ignore capitalization and an optional leading `@`. Only explicitly listed names qualify, including the broadcaster and moderators. The list starts empty, supports up to 100 users, and is visible only to logged-in dashboard operators. Removing a name takes effect on the next command. Access follows the username if it changes ownership; update the list after username changes.

| Admin command | Action |
| --- | --- |
| `!pause`, `!resume` | Pause or resume the current video |
| `!forceskip` | Skip immediately, including during voting; ordinary `!skip` still casts a viewer skip vote |
| `!previous`, `!replay` | Play the previous video or restart the current video |
| `!seek SECONDS` | Seek to an absolute position, for example `!seek 90` |
| `!volume 0-100` | Change volume while preserving mute; zero also mutes |
| `!mute`, `!unmute` | Mute/unmute; unmuting at zero restores volume to 50 |
| `!add URL` | Add directly to Upcoming without request approval |
| `!playnext URL` | Add to Play Next |
| `!playnow URL` | Play immediately, parking interrupted playback to resume next |

Commands ignore capitalization. Video commands also accept a video ID and an optional ` | Display title`, such as `!add dQw4w9WgXcQ | Favorite`. Existing queue ordering and loop settings still apply. Pause, resume and seek are unavailable during voting. Chat cannot edit access, station settings, or the library through deletion or bulk imports.

Admin commands require Twitch's numeric sender identity tag and must originate in the configured channel; messages forwarded from another Shared Chat room are ignored. Both existing connection modes can receive commands when those tags are present. Repeated message IDs are ignored for five minutes. Allow two seconds between admin commands per account; the station accepts at most 30 per minute. The Chat Connections panel shows the latest 20 authorized attempts and their results, including usage errors and throttling. Activity clears when the server restarts. Ordinary chat messages are not stored, and no chat replies are sent.

## Windows automatic startup

1. Extract Playback into a permanent local folder such as `C:\Playback`, with Node installed for all users. Stop any manually launched Playback server, then run **INSTALL-AUTO-START.bat**, choose whether to open OBS automatically, then approve the administrator prompt. The backend starts at Windows boot under LOCAL SERVICE. The browser and optional OBS launch at Windows sign-in, after the backend is healthy.
2. Sign in to the dashboard once with **Keep signed in on this computer for 30 days** checked. Use the same Windows account, normal browser profile and `http://127.0.0.1:4177/control` address after reboot. The browser keeps a signed HttpOnly session cookie; the operator token is not stored in browser storage or startup URLs. Private browsing, cleared cookies, logout or the 30-day expiry require a new login.
3. In OBS, save the Browser Source URL as `http://127.0.0.1:4177/player`, disable **Shutdown source when not visible**, and keep the source active in your startup scene. Disable **Refresh browser when scene becomes active** for continuous playback. Do not open the player in a second regular browser tab.
4. If OBS already has its own Windows startup shortcut/task, remove that duplicate startup entry when using Playback's OBS launch option. Waiting for the server avoids OBS loading a connection-error page before Playback starts. The player retries YouTube API/iframe startup failures without a manual cache refresh once the page has loaded.
5. Restart Windows once to validate the actual workstation setup. **CHECK-AUTO-START.bat** reports task/server status; **UNINSTALL-AUTO-START.bat** removes the tasks without deleting data. Re-run the installer after moving the installation or changing startup options.

Windows must sign in to a desktop before the browser or OBS can run; the boot server alone does not render video. Windows automatic sign-in, if desired, is a separate workstation configuration. Playback's OBS launcher opens OBS with its saved scene; it does not start streaming or recording.

For a custom OBS install, run `powershell -NoProfile -ExecutionPolicy Bypass -File .\ops\register-autostart.ps1 -StartNow -StartOBSAtLogon -ObsPath "D:\OBS\bin\64bit\obs64.exe"` from the Playback folder.

## Data and backups

`DATA_DIR` overrides the default installation-local `data/` directory. Retain all token files, startup configuration and the database when upgrading. Once migrated, the old `state.json` is an archival snapshot and is no longer updated.

```sh
npm run backup
npm test
npm run check
npm run benchmark:storage
```

The backup command writes a verified database snapshot under `data/backups`. See [STORAGE.md](STORAGE.md) for a safe restore procedure and the distinction between a database backup and a complete station backup.

## Operational scope

Playback binds to localhost by default and is intended for a trusted workstation, not a public multi-tenant service. Operator mutations require authentication. Public browser voter identities are not a replacement for account authentication. See [SECURITY.md](SECURITY.md).

Real YouTube availability, embed permissions, browser autoplay, Twitch connectivity, storage latency and OBS rendering must be checked on the streaming computer. An embeddable video is not permission to rebroadcast someone else's content. Source code is MIT licensed; names/logos and bundled third-party software have separate notices.
