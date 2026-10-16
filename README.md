# fKey Playback 1.0.3 — made by fKey Labs Inc.

[Source code](https://github.com/imSlicedBread/Playback) · [Releases](https://github.com/imSlicedBread/Playback/releases) · [MIT License](LICENSE) · [Security](SECURITY.md)

## v1.0.3 — Sidebar and seek bar

- Removed the redundant **fKey** text from the sidebar above Playback. The official icon and **made by fKey Labs Inc.** credit remain intact.
- Restored the draggable/clickable/keyboard-accessible **Now Playing seek bar** with elapsed/total time and an optional exact-seconds jump field. It uses the real playback position and doesn't reset while dragging when dashboard state refreshes.
- Preserved the v1.0.2 official logo and the v1.0.1 automatic title recovery fix.

**Deployable local-station release candidate** for OBS Browser Source on one computer. Requires **Node.js 22.13+**, with no npm dependencies or account required for local use. This is a freshly built implementation based on the provided 24/7 Player specifications, not a byte-for-byte recompilation of the earlier v0.14 ZIP. Live YouTube and Twitch integration must be tested on your station before uninterrupted operation is assumed.

## Fast start (Windows)

1. Extract the full ZIP to a persistent folder, such as `C:\Playback`. **Do not launch from inside the ZIP.**
2. Install Node.js 22.13 or newer (LTS recommended).
3. Double-click `start-player.bat`, then open <http://127.0.0.1:4177/control>.
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

- **Durable state:** JSON snapshot written using temp file, file fsync, atomic rename, and a previous snapshot. Stores exact queue identity, active video, playhead, duration, pause state, vote tallies, remaining countdown, history, suggestions, layout and colors. Closing and restarting the app resumes the saved position; offline time does **not** run down vote time.
- **Protected operator API:** randomly generated token on first run; HTTP-only, SameSite-strict session cookie; origin checks; input and YouTube ID validation; login and voting rate limits; static-file allowlisting. Localhost only by default.
- **Single authoritative OBS playback worker:** browser-source lease, generation checks to reject stale heartbeats/end events, and restart recovery. If an embed fails, it is quarantined from the loop to avoid an endless error cycle.
- **Operator vote override:** start, cancel or immediately choose a vote round from the dashboard.
- **Full queue controls:** add, batch import (300 at once), play now, reorder, remove, previous, replay, play/pause, skip, clickable/draggable seek bar with current/total time, precise seek in seconds, and optional playlist loop. The timeline remains interactive during background polling.
- **2 × 2 end voting:** candidate thumbnails, number, title, count and countdown; tie-breaks favor earliest available choice. One vote per recognized Twitch identity or local browser cookie per round, with vote changes allowed. Operator may choose instantly.
- **Twitch IRC reader:** disabled by default; anonymous public chat read (unofficial) or authenticated IRC with environment variables. Parses `!vote 1` ... `!vote 4`, `!skip`, and `!request YOUTUBE_URL` (or `!suggest YOUTUBE_URL`); no Twitch chat messages are stored. In Settings, enter the channel, choose mode and Save.
- **OBS lower-third editor:** drag, resize, set X / Y / Width / Scale, choose top or bottom anchor, snap to top/bottom. Bottom-anchor Y = 0 uses CSS `bottom:0` in OBS, so it actually docks to the frame. Position and colors update at the next polling interval (~1 second).
- **Automatic YouTube titles:** when videos are added without a custom title, a bounded background lookup attempts to retrieve the actual title from YouTube oEmbed, and the active YouTube iframe can also supply its loaded title. Recovered titles are saved into `data/state.json` and update the OBS lower third, queue, and voting choices automatically (normally in a few seconds). Custom titles are never overwritten; private or restricted videos may still need a manually entered title.
- **Title ticker:** long titles scroll left in OBS. Long titles are remeasured on resize and when the lower third becomes visible. Turn it off to keep titles stationary. Caption hiding is attempted through YouTube's IFrame API but is not guaranteed.
- **Vote screen editor:** edit title, instructions, card gap, opacity, thumbnails, vote counters, countdown and border treatment. Preview and live output use the same renderer.
- **Settings tabs:** Playback, Lower Third, Vote Screen, Twitch Chat, Appearance. Custom RGB hex colors and fKeyLabs-derived palettes. The white keycap `f` is always white.

## Updating from Playback v1.0.0 or the previous prototype

**From Playback 1.0.0–1.0.2:** Stop the server, back up your entire `data/` directory, extract 1.0.3 to a new folder, and copy the saved `data/` directory over before starting. OBS Browser Source JavaScript is cached for up to five minutes; refresh the source (OBS: right-click the source → Refresh) after installing. Titles previously stored as `YouTube · VIDEO_ID` will be resolved automatically when available.


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

The **Node process must stay running** and OBS must keep the Browser Source active. On Windows, you can launch `ops/start-player-supervised.bat` to restart Node after an unexpected failure. To opt into launch at sign-in, run `ops/register-autostart.ps1` from PowerShell; to remove it, run `ops/unregister-autostart.ps1`. The task starts only the backend; OBS needs its own autostart setup.

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

Automated tests cover queue actions, restart checkpoints, worker lease/generation protection, voting and ties, metadata lookup and title recovery, captions/ticker config validation, UI route protection, save-and-ack protocols, Twitch IRC message parsing and JSON input hardening. **Real YouTube playback, OBS browser-rendered placement and real Twitch connectivity require a final on-device test** in OBS, with your stream and channel.

## fKeyLabs visual identity

Dark black `#0D1010`, carbon `#111318`, slate `#171A1F`, white text, restrained cyan `#00AFFF`, semantic status colors and JetBrains Mono (system installed if available). The package includes the **official fKey Playback logo** provided by the owner at `public/assets/logo.png`. The old placeholder keycap asset is retired.

## Release notes

Release 1.0.3: removes redundant sidebar text and restores a true interactive seek bar. Release 1.0.2: adopts the official logo. Release 1.0.1: fixes missing titles in OBS with YouTube oEmbed discovery and IFrame metadata persistence; keeps title scrolling on layout changes. Release 1.0.0 introduced operator access protection, atomic station state, worker leases and staleness checks, auto advance and vote handling, Twitch IRC vote parser, settings tabs, vote screen editor, lower third top/bottom anchor consistency, and responsive control interface. No npm dependencies.

## License and brand

Playback source is licensed under the [MIT License](LICENSE), copyright 2026 fKey Labs Inc. The fKeyLabs name, marks and logos are not licensed for use as an official brand by third parties; see [TRADEMARKS.md](TRADEMARKS.md). YouTube videos and third-party platform APIs remain subject to their respective rights and terms.