# fKey Playback v1.0.1 — Title recovery fix

fKey Playback is a local OBS / 24-7 YouTube station made by **fKey Labs Inc.** This is a **local-station production candidate**, not a guarantee of uninterrupted YouTube streaming.

## Fixed in v1.0.1

- Real YouTube video titles now appear in the OBS lower third, dashboard, queue and voting choices after a background metadata lookup or when the playing YouTube iframe reports its title.
- Recovered titles persist across shutdowns and restarts. Custom titles remain unchanged.
- Title ticker remeasures long titles on resizes and when the lower third reappears.
- If YouTube restricts metadata, the video ID remains a fallback and the operator can supply a title manually.

## Highlights

- Durable playback state, current video ID, queue, progress, votes and restart recovery.
- OBS Browser Source at `http://127.0.0.1:4177/player`, separate from operator controls.
- Operator dashboard at `http://127.0.0.1:4177/control` with token-based access.
- Customizable lower third (position, size, top/bottom anchors), theme colors,
  tabbed settings, title marquee, and best-effort caption hiding.
- Editable 2 × 2 end-of-video vote screen, optional Twitch chat reader,
  vote-to-skip and moderated requests.
- Windows, Linux, macOS launchers; Node.js 22.13+; no npm dependencies.

## Download and install

1. Download `Playback-v1.0.1.zip` below and extract into a dedicated folder.
2. Install Node.js 22.13 or newer.
3. On Windows run `start-player.bat`, on Linux/macOS run `./start-player.sh`.
4. Open `http://127.0.0.1:4177/control`, sign in with the token in
   `data/admin-token.txt`, and configure your video queue and Twitch channel.
5. Add an OBS Browser Source using `http://127.0.0.1:4177/player` and size 1920x1080.

## Notes before streaming

- Test live OBS, YouTube IFrame and Twitch network behavior on the target station.
- Twitch anonymous IRC is unofficial and may stop working; never assume official support.
- This local server is not designed to be internet-exposed, and community browser
  voting identities are not hardened against multiple accounts.
- Migrating state from the earlier v0.14 prototype is **best-effort only**.
  Back up your original `data/` before upgrading and validate the import.
- Use YouTube content only when you have the necessary streaming/rebroadcast rights.

See README.md for the full setup and limitations. MIT-licensed source is available
in this repository; fKeyLabs marks remain subject to trademark rights.