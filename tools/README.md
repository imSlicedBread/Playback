# Playlist extraction tool

On Windows, download `yt-dlp.exe` from the official release at
https://github.com/yt-dlp/yt-dlp/releases/latest and place it beside this
README as `tools/yt-dlp.exe`. On macOS/Linux, install `yt-dlp` into PATH,
or place the executable here as `tools/yt-dlp` and mark it executable.

You can also set the `YT_DLP_PATH` environment variable to an absolute path
before starting Playback. `yt-dlp` is third-party software, is not included
in this distribution, and should be updated when YouTube changes.

Alternatively set `YOUTUBE_API_KEY` in the server environment to use the
YouTube Data API v3. Metadata is extracted; Playback never downloads videos.