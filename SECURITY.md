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
  `voter-secret.txt`, OAuth tokens, and copied state files out of Git.
- Use trusted locally installed Node.js runtimes and monitor your OBS machine.
- Treat user-submitted URLs and votes as untrusted input and avoid running the
  application with elevated privileges.
- If you need a public portal, add proper account authentication, CSRF/abuse
  protection, a hardened HTTPS deployment, and operational monitoring first.