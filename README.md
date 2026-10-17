# fKey Playback 1.2.4 — made by fKey Labs Inc.

## v1.2.4 — Large-queue performance

The control panel now displays 50 videos per page with lane-wide search, cross-page selection and stable dropdowns. It receives compact live updates instead of repeatedly transferring and rendering all videos. Now Playing and idle panels update only when relevant data changes. Automatic polling pauses when the dashboard is hidden; OBS playback does not.

See [PERFORMANCE.md](PERFORMANCE.md) for measured before/after results and test limits. Existing playlists, rotations, settings, seek, volume and Windows startup behavior remain available; the data schema and 2,000-video capacity are unchanged. **Select this page** checks the displayed videos, and **Clear selection** clears cross-page selections. Reordering a searched result changes its original position in the lane.


[Source code](https://github.com/imSlicedBread/Playback) · [Releases](https://github.com/imSlicedBread/Playback/releases) · [MIT License](LICENSE) · [Security](SECURITY.md)

## v1.2.3 — queue dropdown stability during live updates

- Fixes the **Move** dropdown in Smart Rotation Queue closing every 1.3 seconds while the dashboard polls for playback changes.
- Updates queue rows by their stable entry ID instead of destroying and recreating every DOM row. The dropdown remains mounted and retains its chosen destination while the queue updates.
- Play, Play Next, Move, Up, Down and Remove actions use the latest queue position, even if another video was moved while the dashboard was open.
- **Upgrade:** Stop Playback, back up the `data/` folder, install v1.2.3, and restore the folder. Refresh the dashboard once (Ctrl+F5). Queue, playhead, Twitch, OBS, rotations and importer settings are preserved.

## v1.2.2 — OBS lower-third opacity, manual height and improved preview

In **Settings → Lower Third**, the 16:9 preview now shares the horizontal workspace with a **Position & Dimensions** inspector on wide screens, and stacks above it on tablets/phones. Frame guides and a safe-area outline make it easier to position text. The mock video background lets you see background opacity changes as you make them.

- **Background opacity (0–100%)**: Adjusts only the lower-third card's background, not the text, border/accent, OBS video, or other overlays. The default is **89%**, matching older versions. **0%** makes the background fully transparent; **100%** makes it solid.
- **Height (%)**: **0 = Auto Height** (fit the text as before), or choose an explicit **4–65% of the OBS frame height**. Use the **Auto Height** button to return to content-driven sizing. The existing width, X/Y position, title text size, overall text scale, vertical anchor, and visibility switches still work.
- **Two-dimensional resize**: Drag the cyan corner of the lower-third card to change width **and** height. With **Bottom edge** anchoring, the handle appears on the **top-right**, expanding upward while the bottom stays pinned. With **Top edge**, the handle moves to the **bottom-right**. Keyboard users can focus the handle: Left/Right adjust width and Up/Down adjust height (Shift = 5% steps). Dragging the card itself still changes its X/Y position.
- **Live preview and saving**: Preview uses the shared OBS layout renderer. Click **Save Settings** to update the active `/player` OBS Browser Source and checkpoint new settings in `data/state.json`. **Discard Changes** and **Reset Lower Third** also account for the new options. Height + Y margin must fit inside the video frame; extremely large text may not fit into a manually forced small height, so use Auto Height if text is clipped.

Old settings migrate with **Auto Height / 89% background opacity**, preserving the previous appearance. You do not need to recreate the OBS Browser Source, but refresh it once after upgrading to load the versioned JavaScript and CSS. The YouTube title, skip voting, playlists and existing queue remain unchanged. The included source-only ZIP does **not** contain `yt-dlp.exe`; the official GitHub Windows release continues to bundle the verified executable.



## v1.2.1 — Playlist importer reset and lower-third toolbar alignment

- After **Import Selected to Queue** succeeds, the importer clears the playlist URL, extracted preview/list, selection, and starting index, returning focus to the playlist URL. The green confirmation remains visible and queue state is unchanged. If the import fails, the preview and selections remain for retry.
- Import destination, order, duplicate preference, and batch size are retained. To import the next batch of the same playlist after a completed import, paste its URL again and set the starting video index.
- **Settings → Lower Third** now has a full-width, aligned and responsive Anchor edge / Snap to Bottom / Snap to Top / Reset Lower Third toolbar, with its position readout directly beneath.


## v1.2.0 — Smart Rotation Queues and bundled Windows playlist extractor

Playback now maintains **four separate, durable queue lanes** rather than appending completed videos to the end of the same list:

| Lane | What it does |
| --- | --- |
| **Play Next** | Pinned requests take priority over the ordinary queue, in order. |
| **Upcoming** | Videos that have **not played in the current rotation**, including new playlist imports. |
| **Recycled** | Videos that already completed (or were skipped), waiting for a later rotation. |
| **Next Rotation** | Explicitly deferred videos. They are promoted ahead of Recycled when the current rotation ends. |

When Play Next and Upcoming are both empty, Playback starts **Rotation N+1** (with looping enabled). Next Rotation and Recycled move into Upcoming; completed and skipped videos never jump ahead of new uploads. Failed/private/unsupported videos go to history as unavailable instead of looping forever. Operator **Play Now** preserves the interrupted video's timestamp in Play Next so you can resume it afterward. Previous and Replay remain available. Playlist voting draws only from Play Next and Upcoming; the last available round can roll over to recycled videos at the rotation boundary.

Under **Control → Smart Rotation Queue**, use the four tabs to review each lane, **Play Now**, **Play Next**, **Move to Current Rotation**, **Move to Next Rotation**, **Move to Recycled**, or **Remove** any queued item. Multi-select and **Move Selected** provide bulk management. Use **Sort Upcoming** for arrival order, title, oldest/newest published (when metadata exists), or random shuffle. Playback's queue has a **2,000-entry total capacity across all four lanes and the currently playing video**. Existing saved 1.x `data/state.json` is automatically migrated, preserving the current playback position, queue, voting and settings; it backs up `data/state.before-rotation-migration.json` before migration. Back up `data/` yourself before replacing the installation. Downgrading to 1.1.x after migration is not supported.

The playlist importer now lets you choose **Play Next**, **Current Rotation**, or **Next Rotation**, plus playlist order, oldest-first, or newest-first when upload dates are available. Duplicates can be avoided across all four lanes; imported content still does not interrupt the current video.

### yt-dlp included in the official Windows ZIP

The **official GitHub v1.2.1 Windows release** prepackages upstream `tools/yt-dlp.exe` version **2026.08.19** for Windows x64. It is downloaded by GitHub Actions from the official upstream release and checked against SHA-256 `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a` before publishing. No manual yt-dlp installation, separate Python installation, or YouTube Data API key is required. It is **not committed into the source repository**. Linux/macOS still need a locally installed `yt-dlp` or `YT_DLP_PATH`. Source-only builds from a checkout must run `python ops/bundle-yt-dlp.py` first on an Internet-connected machine. Do not download binaries from unofficial mirrors.

**Third-party licenses:** The bundled upstream `yt-dlp.exe` is a separately invoked executable whose PyInstaller distribution contains GPLv3+ code. It is not covered by Playback's MIT license. See `tools/README.md` and the upstream third-party license files bundled in the official ZIP. Sources: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19 and https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19.

## v1.1.0 — YouTube playlist importer / extractor

In the **Control** dashboard, open **YOUTUBE PLAYLIST IMPORTER** below Now Playing and Add Video:

1. Paste a public YouTube `playlist?list=...` URL or a `watch?v=...&list=...` link.
2. Choose a start position and batch size (50, 100, 250 or 500 entries). Click **Extract Videos**.
3. Review the extracted titles and thumbnails, uncheck videos you do not want (or use Select All / Select None). You can also **Copy Selected URLs** or **Export Selected CSV** without changing playback. Choose whether to skip already queued videos and duplicates.
4. Click **Import Selected to Queue**. Video order is preserved. The current video's playhead, OBS source and settings remain unchanged. On success, the preview and URL clear for the next playlist; to import the next batch of a large playlist, paste the URL again and enter its new start position (or use **Extract Next Batch** before importing).

**Extractor setup:** The official v1.2.1 Windows release ZIP already includes `tools/yt-dlp.exe`. On Linux/macOS install `yt-dlp` in PATH or set `YT_DLP_PATH`. If running from source, see the v1.2.0 setup above.

**Official API alternative:** Set `YOUTUBE_API_KEY` in the server environment to retrieve playlist metadata using YouTube Data API v3 without installing `yt-dlp`. API access is subject to your YouTube quota. A full batch may take some time; only one extraction runs at a time. Previews are temporary (15 minutes), are not saved, and do not alter the queue until imported. Entries marked deleted/private/unavailable are skipped. Playlist entries beyond 500 must be extracted as additional batches. The four rotation lanes and current video together support up to 2,000 entries. Extracted titles can still be corrected with the existing title resolver. `yt-dlp` is prebundled in official Windows v1.2.1 release packages and remains optional for source checkouts / non-Windows platforms. Importing metadata does **not** download videos, bypass embed restrictions, or grant broadcasting permission.

## v1.0.9 — Customizable OBS lower third

Open **Settings → Lower Third** to control exactly what the stream sees. The four optional labels are now **off by default**, producing a compact title-only lower third:

- **Channel label** — show/hide the channel name above the title.
- **“NOW PLAYING”** — show/hide the upper-right status label.
- **Video duration** — show/hide total video runtime beneath the title.
- **Skip vote count** — show/hide the skip-vote indicator without disabling voting.
- **Video title text size** — independent 50–300% slider for the title font; **Text Scale** still resizes the rest of the lower third. Long titles continue to scroll left when that setting is enabled.

Use the live 16:9 preview to adjust the overlay, then click **Save Settings**. An active `/player` OBS source applies changes on its next poll (normally 1–2 seconds); the settings are stored in `data/state.json` and survive restarts. Position, anchor, width, colors and queue are retained when upgrading. Since older saved states had no visibility flags, those four labels default to **hidden** upon the first v1.0.9 load; you can turn any of them back on. **Reset Lower Third** resets the layout to title-only defaults (save afterward). The `?clean=1` OBS source still suppresses the entire lower third.

## v1.0.8 — Start automatically with Windows

**One-time setup on the streaming PC:**

1. Stop any manually running Playback server. Back up the complete `data/` folder.
2. Extract Playback into a permanent folder such as `C:\Playback` (not Downloads, Desktop, a user profile or a network drive). Restore your saved `data/` folder there. Install Node.js 22.13+ **for all users**.
3. Double-click **`INSTALL-AUTO-START.bat`** and approve the Windows administrator prompt. The installer registers a Windows Task Scheduler **At startup** task running as the restricted **LOCAL SERVICE** account, with permission to write only the `data/` folder. It starts the background server immediately and again after future boots, **without requiring sign-in**.
4. At your next Windows sign-in the browser automatically opens the **dashboard** (`http://127.0.0.1:4177/control`) once the server is healthy. The background task itself never opens a browser or an OBS player.
5. Reboot and check `http://127.0.0.1:4177/api/health`, or double-click **`CHECK-AUTO-START.bat`**. If the server fails, read `data/boot-service.log` and inspect the tasks in Windows Task Scheduler.

**To disable auto-start**, double-click `UNINSTALL-AUTO-START.bat` and approve the UAC prompt. Your videos, queue, timestamp and settings remain on disk. The installer also retires the prior sign-in-only task (`fKeyLabs Playback`) to prevent duplicate servers. For advanced setups, run `ops/register-autostart.ps1 -Port 4177 -StartNow` as administrator, adding `-NoDashboardAtLogon` to skip automatic dashboard opening. If Node is installed under a private user profile rather than system-wide, reinstall Node for all users.

**Playback limitation:** Windows can start the **Node backend** before sign-in, but **OBS and YouTube playback need an interactive desktop session** and an active OBS Browser Source. Boot startup alone does not start OBS or keep a YouTube video playing while Windows remains at the sign-in screen. Configure OBS to start separately at sign-in and keep the Browser Source active if you need full broadcasting automation. The OS must remain powered on.

**Security:** The service is deliberately NOT run as `SYSTEM`. Only the data directory is granted additional write access. Keep source files out of untrusted shared directories. The HTTP server remains bound to loopback, and the operator token stays local. Re-run `INSTALL-AUTO-START.bat` after relocating or upgrading Playback to update the scheduled task path.

## v1.0.7 — Transport buttons centered at X

- Place Previous / Pause / Replay / Next at the horizontal center of the whole Now Playing panel, not left-aligned or centered within a narrow subcontainer.
- Keep the Jump to seconds field in a separate full-width row beneath the buttons.
- Bypass stale dashboard CSS using a versioned asset URL; refresh the dashboard to apply the layout.

## v1.0.5 — Open the dashboard automatically on launch

- **Windows:** double-click `start-player.bat`. Once the station successfully starts, the default browser opens `http://127.0.0.1:4177/control` automatically. Leave the command window running.
- **macOS/Linux desktop:** `./start-player.sh` also opens the operator dashboard in your default browser once the server starts. Headless Linux sessions skip browser opening.
- Only the **operator dashboard** opens — **not `/player`**, which is reserved for the OBS Browser Source. The automated Windows sign-in/supervised launcher remains headless to avoid opening tabs during unattended restarts.
- **Optional:** set `PB_OPEN_BROWSER=0` in the launch environment to suppress automatic browser opening. Running `node server.js` or `npm start` also starts the server without opening a browser by default. Custom `PORT` values are respected.
- A missing browser or desktop launcher does not stop the Playback server; use the dashboard URL printed in the terminal manually.

## v1.0.6 — Transport controls between seek and volume bars

- Move the Previous, Pause, Replay and Next row between the timeline and volume bars; v1.0.7 centers that row at the full Now Playing panel midpoint.

## v1.0.4 — YouTube volume and mute controls

- A **0–100% volume slider and Mute / Unmute button** are located immediately below the Now Playing seek bar on the operator dashboard.
- Drag or click the volume slider, or focus it and use the arrow keys. It applies to **YouTube playback inside the OBS Browser Source**, with rapid changes throttled to avoid excessive writes. Muting preserves the selected level; dragging above zero unmutes, while setting zero mutes.
- Volume and mute are persisted in `data/state.json`, synchronized to any connected `/player` output in about 1–2 seconds, and restored across video changes and server/OBS restarts. They also work before a video starts.
- The control **does not alter OBS's Audio Mixer fader**, desktop/system output volume, or other OBS sources. Make sure the Browser Source's audio is enabled in OBS; browser autoplay restrictions still apply.

## v1.0.3 — Sidebar and seek bar

- Removed the redundant **fKey** text from the sidebar above Playback. The official icon and **made by fKey Labs Inc.** credit remain intact.
- Restored the draggable/clickable/keyboard-accessible **Now Playing seek bar** with elapsed/total time and an optional exact-seconds jump field. It uses the real playback position and doesn't reset while dragging when dashboard state refreshes.
- Preserved the v1.0.2 official logo and the v1.0.1 automatic title recovery fix.

**Deployable local-station release candidate** for OBS Browser Source on one computer. Requires **Node.js 22.13+**, with no npm dependencies or account required for local use. This is a freshly built implementation based on the provided 24/7 Player specifications, not a byte-for-byte recompilation of the earlier v0.14 ZIP. Live YouTube and Twitch integration must be tested on your station before uninterrupted operation is assumed.

## Fast start (Windows)

1. Extract the full ZIP to a persistent folder, such as `C:\Playback`. **Do not launch from inside the ZIP.**
2. Install Node.js 22.13 or newer (LTS recommended).
3. Double-click `start-player.bat`. The dashboard opens automatically in your default browser **after the server is ready**. If it does not, use <http://127.0.0.1:4177/control>.
4. On first run the station creates `data/admin-token.txt`. Open it on the station and paste the token into the operator login dialog. Keep it private.
5. Add a YouTube URL to the queue. Add four more if you want four choices at the end of a video.
6. In OBS Studio, create a **Browser Source**, set URL to <http://127.0.0.1:4177/player>, width **1920**, height **1080**, and leave the browser source active. The player is separate from the operator dashboard.
7. Test a full video end, vote, restart and recovery before broadcasting. Ensure you have rebroadcast rights for any video.

**Linux/macOS:** `./start-player.sh`, or `node server.js`. On Linux you may first need `chmod +x start-player.sh`.

## Page addresses

| Page | Local URL | Function |
| --- | --- | --- |
| Studio dashboard | `http://127.0.0.1:4177/control` | Protected operator controls, queue, requests and vote override |
| Settings | `http://127.0.0.1:4177/settings` | Tabbed playback, lower third, vote screen, Twitch and appearance editors |
| OBS full source | `http://127.0.0.1:4177/player` | YouTube player, lower third, full-frame vote overlay |
| OBS clean source | `http://127.0.0.1:4177/player?clean=1` | No lower third; vote overlay remains |
| Viewer portal | `http://127.0.0.1:4177/vote` | Optional **local** viewer voting and moderated suggestions |
| Health probe | `http://127.0.0.1:4177/api/health` | JSON health/worker status |

You can create one OBS Browser Source at 1920 × 1080; OBS audio configuration is in the source's properties. If OBS is configured to shut down browser sources when hidden, playback will stop and resume from its most recent committed checkpoint when reactivated. The server itself does not render/encode video and **cannot play YouTube while OBS and all player browsers are closed**.

## Production-station capabilities

- **Durable state:** JSON snapshot written using temp file, file fsync, atomic rename, and a previous snapshot. Stores exact queue identity, active video, playhead, duration, pause state, volume and mute preference, vote tallies, remaining countdown, history, suggestions, layout and colors. Closing and restarting the app resumes the saved position; offline time does **not** run down vote time.
- **Protected operator API:** randomly generated token on first run; HTTP-only, SameSite-strict session cookie; origin checks; input and YouTube ID validation; login and voting rate limits; static-file allowlisting. Localhost only by default.
- **Single authoritative OBS playback worker:** browser-source lease, generation checks to reject stale heartbeats/end events, and restart recovery. If an embed fails, it is quarantined from the loop to avoid an endless error cycle.
- **Operator vote override:** start, cancel or immediately choose a vote round from the dashboard.
- **Full queue controls:** add, batch import (300 at once), play now, reorder, remove, previous, replay, play/pause, skip, clickable/draggable seek bar with current/total time, precise seek in seconds, **YouTube audio volume (0–100%) and mute/unmute**, and optional playlist loop. The timeline and audio controls remain interactive during background polling.
- **2 × 2 end voting:** candidate thumbnails, number, title, count and countdown; tie-breaks favor earliest available choice. One vote per recognized Twitch identity or local browser cookie per round, with vote changes allowed. Operator may choose instantly.
- **Twitch IRC reader:** disabled by default; anonymous public chat read (unofficial) or authenticated IRC with environment variables. Parses `!vote 1` ... `!vote 4`, `!skip`, and `!request YOUTUBE_URL` (or `!suggest YOUTUBE_URL`); no Twitch chat messages are stored. In Settings, enter the channel, choose mode and Save.
- **OBS lower-third editor:** drag, resize, set X / Y / Width / Scale, choose top or bottom anchor, snap to top/bottom. Bottom-anchor Y = 0 uses CSS `bottom:0` in OBS, so it actually docks to the frame. Position and colors update at the next polling interval (~1 second).
- **Automatic YouTube titles:** when videos are added without a custom title, a bounded background lookup attempts to retrieve the actual title from YouTube oEmbed, and the active YouTube iframe can also supply its loaded title. Recovered titles are saved into `data/state.json` and update the OBS lower third, queue, and voting choices automatically (normally in a few seconds). Custom titles are never overwritten; private or restricted videos may still need a manually entered title.
- **Title ticker:** long titles scroll left in OBS. Long titles are remeasured on resize and when the lower third becomes visible. Turn it off to keep titles stationary. Caption hiding is attempted through YouTube's IFrame API but is not guaranteed.
- **Vote screen editor:** edit title, instructions, card gap, opacity, thumbnails, vote counters, countdown and border treatment. Preview and live output use the same renderer.
- **Settings tabs:** Playback, Lower Third, Vote Screen, Twitch Chat, Appearance. Custom RGB hex colors and fKeyLabs-derived palettes. The white keycap `f` is always white.

## Updating from Playback v1.0.0 or the previous prototype

**From Playback 1.0.0–1.0.7:** Stop the server, back up your entire `data/` directory, extract 1.2.1 to a new folder, and copy the saved `data/` directory over before starting. OBS Browser Source JavaScript is cached for up to five minutes; refresh the source (OBS: right-click the source → Refresh) after installing. Titles previously stored as `YouTube · VIDEO_ID` will be resolved automatically when available.


**Your earlier v0.14 archive cannot be treated as a verified drop-in upgrade:** its complete source was not accessible when this package was made. To migrate safely:

1. Stop the old server and all copies of Playback. Confirm port **4177** is no longer in use. Back up the entire old installation, especially `data/state.json`, all token files and any Twitch configuration.
2. Extract this release into a **new, empty folder**.
3. Copy the backed-up `data/state.json` into the new release's `data/` directory **before first run**. Do not copy an old `admin-token.txt` unless you intentionally wish to retain that secret.
4. Start the new server. It backs up non-v1 state automatically to `data/state.before-production-migration.json` and attempts to import recognized current video, position, queue, history and settings fields.
5. **Verify** queue entries, title, current position, settings, lower third and Twitch channel. Unknown legacy structures are not guaranteed to map; never delete the old backup until verified. If the old state structure is incompatible, start with a fresh data directory, then re-import your video URLs.
6. Refresh the OBS Browser Source URL if its JS assets were cached. Do not run old and new installations together on the same port.

The new state model uses `schemaVersion: 1`. After first save it should only be read/written by Playback 1.x. **Downgrading to the prototype is not supported.**

## Configuration and local security

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Bind local HTTP listener |
| `PORT` | `4177` | HTTP port |
| `DATA_DIR` | `./data` relative to installation | Persistent station data directory |
| `ADMIN_TOKEN` | Auto-generated and stored in `data/admin-token.txt` | Optional token override; keep secret |
| `TWITCH_USERNAME` | Unset | IRC chat account (authenticated mode) |
| `TWITCH_OAUTH_TOKEN` | Unset | OAuth credential with chat read permission, server only |
| `PUBLIC_HOST` | Unset | Additional permitted public hostname for a **loopback reverse proxy** |

**Do not expose the station directly to the Internet.** `HOST=0.0.0.0` does not make the built-in server a safely internet-facing service; remote plaintext requests are denied. A configured reverse proxy must terminate HTTPS and should add its own access restrictions. Anonymous viewer cookies do not provide anti-Sybil public identity security. Use authenticated Twitch chat voting for a better identity source, or an external properly authenticated voting frontend. Never embed the operator token in an OBS URL or paste it into chat.

YouTube requires an HTTP Referer for embedded playback; this release intentionally sets `Referrer-Policy: strict-origin-when-cross-origin` to avoid Error 153. If a reverse proxy overrides this header, restore it.

The server has **no** built-in YouTube rebroadcast permission management, video download, schedule/import synchronization, embedded caption pixel removal, Twitch EventSub/OAuth refresh, protected internet-facing viewer service, or guarantee that Twitch's unofficial anonymous IRC login will continue working.

## Keep the station running

The **Node process must stay running** and OBS must keep the Browser Source active. On Windows, use `INSTALL-AUTO-START.bat` for boot-level Task Scheduler startup and automatic restart after failures. `CHECK-AUTO-START.bat` shows task status; `UNINSTALL-AUTO-START.bat` disables boot startup. `ops/start-player-supervised.bat` remains available for manual foreground supervision. The boot task starts only the backend; OBS needs its own autostart setup.

For unattended Linux service operation, configure systemd with `Restart=on-failure`, a dedicated user, and a `WorkingDirectory` pointing to the unpacked release; supply Node's full path in `ExecStart`. Configure `After=network-online.target`, persistent `DATA_DIR`, and OBS separately. Monitor `GET /api/health` and confirm `workerActive:true` during broadcast.

## Backup and recovery

- Keep offline copies of `data/state.json` and the generated secrets. The file is atomically replaced after each control command, position update and vote countdown. The previous version is kept as `data/state.previous.json`.
- Stop the server for a complete, consistent backup of the `data/` directory and secrets. Never send `admin-token.txt`, `session-secret.txt`, `voter-secret.txt` or OAuth credentials to viewers.
- If the current snapshot is corrupt, stop Playback and inspect `data/state.previous.json` before manually copying it over `state.json`. Do not blindly overwrite state while the service is running.
- On a real machine shutdown, the last successfully saved position resumes. Any seconds played **between the most recent heartbeat and a sudden power loss** may replay; polling is approximately every two seconds.

## Verification

At the installation folder:

```sh
npm run check
npm test
npm start
```

Automated tests cover queue actions, restart checkpoints, worker lease/generation protection, voting and ties, metadata lookup and title recovery, **authenticated audio and mute controls, volume persistence and YouTube IFrame audio API calls**, captions/ticker config validation, UI route protection, save-and-ack protocols, Twitch IRC message parsing and JSON input hardening. **Real YouTube playback, OBS browser-rendered placement and real Twitch connectivity require a final on-device test** in OBS, with your stream and channel.

## fKeyLabs visual identity

Dark black `#0D1010`, carbon `#111318`, slate `#171A1F`, white text, restrained cyan `#00AFFF`, semantic status colors and JetBrains Mono (system installed if available). The package includes the **official fKey Playback logo** provided by the owner at `public/assets/logo.png`. The old placeholder keycap asset is retired.

## Release notes

Release 1.0.3: removes redundant sidebar text and restores a true interactive seek bar. Release 1.0.2: adopts the official logo. Release 1.0.1: fixes missing titles in OBS with YouTube oEmbed discovery and IFrame metadata persistence; keeps title scrolling on layout changes. Release 1.0.0 introduced operator access protection, atomic station state, worker leases and staleness checks, auto advance and vote handling, Twitch IRC vote parser, settings tabs, vote screen editor, lower third top/bottom anchor consistency, and responsive control interface. No npm dependencies.

## License and brand

Playback source is licensed under the [MIT License](LICENSE), copyright 2026 fKey Labs Inc. The fKeyLabs name, marks and logos are not licensed for use as an official brand by third parties; see [TRADEMARKS.md](TRADEMARKS.md). YouTube videos and third-party platform APIs remain subject to their respective rights and terms.
