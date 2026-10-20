# Security policy

## Supported versions

Only the latest GitHub release on the `main` branch is maintained.

## Report security issues

Do not publicly post exploitable details or secrets in GitHub issues. Use GitHub's
**Security** tab and its private vulnerability reporting feature if enabled;
otherwise contact the repository owner privately through a suitable verified
channel. Do not put tokens, credentials, state snapshots or private Twitch chat
contents in a report.

## Deployment security

- Keep Playback bound to `127.0.0.1` and do not expose its HTTP endpoints directly
  to the public internet.
- Keep `data/`, `admin-token.txt`, `session-secret.txt`,
  `voter-secret.txt`, `soop-auth.json`, OAuth tokens, and copied state files out of Git.
- Use trusted locally installed Node.js runtimes and monitor your OBS machine.
- Treat user-submitted URLs and votes as untrusted input and avoid running the
  application with elevated privileges.
- If you need a public portal, add proper account authentication, CSRF/abuse
  protection, a hardened HTTPS deployment, and operational monitoring first.

## Windows boot auto-start

The optional boot Task Scheduler job runs fKey Playback as **LOCAL SERVICE**, not SYSTEM or an administrator. It adds LOCAL SERVICE Modify access to the station's `data/` folder only. Keep the installation in a local system-readable directory such as `C:\Playback`, outside private profile directories. The backend still binds to loopback; never publish operator endpoints directly to the Internet. Re-run the installer after updates or moving the installation so its paths are accurate.

## Optional YouTube sign-in in OBS

Google sign-in takes place on Google/YouTube inside the OBS Browser Source. Playback does not read, copy or store those credentials or cookies, and cannot verify which account is signed in. OBS manages that browser session. Keep OBS profile data private. Account mode uses the regular YouTube embed host and may show YouTube prompts; it does not bypass access checks or embedding restrictions. Sign in before broadcasting to keep login screens out of the output.

### Experimental OBS watch-page plugin

The Windows plugin uses OBS Browser's default account session and does not read,
copy, export or send Google cookies or credentials to Playback. Its native network
client contacts only `127.0.0.1` on the selected station port, with redirects
disabled. Queue commands are injected only on the matching HTTPS YouTube watch
page; status/progress callbacks require the active generation and a per-generation
nonce. Access barriers hold the entry and require manual attention. The plugin
does not accept content warnings, perform age verification, or grant membership
access. The plugin and ordinary player share the existing exclusive local worker
lease. Members-only video playback was user-verified on October 20, 2026 with
a signed-in, entitled account in the native plugin. This does not grant access
to other accounts or establish login persistence through a full Windows reboot.

Native plugin audio capture targets active Windows audio sessions owned by
`obs-browser-page.exe` processes descended from this OBS instance. It excludes
OBS's own monitoring process and unrelated applications. Audible OBS browser
panels sharing that process may also be captured; mute unused panels. Audio is
sent to the local OBS source mixer, with no audio recordings or samples stored
by the plugin. Diagnostic logs record connection/signal presence only.
