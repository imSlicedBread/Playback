# Playback v1.3.1 — Storage verification and bulk-move UI

## Scope

Production persistence moves from full-file JSON snapshots to SQLite row storage. The total queue cap and startup truncation are removed. The existing state schema, controls, stable queue identities and dashboard paging remain compatible. This release does not store video media or provide a hosted multi-tenant service.

## Executed locally

- `npm run check`: JavaScript syntax checks passed.
- `npm test`: v1.3.0 baseline was 101 tests passed, zero failed, one Windows-only skipped. v1.3.1 adds bulk-move progress and HTTP/SQLite regression coverage.
- SQLite tests: imports and exact reloads at 2,501 and 10,000 videos; all-lane migration of 7,981 entries; current time, audio, voting and lower-third preservation; indexed queue ordering; no catalog enumeration during runtime checkpoints; small row deltas on skip; transactional rollback; interrupted migration retry; newer/corrupt input rejection; exact ordering after bulk moves/reorders/shuffle; live backup integrity; forced-process-termination recovery.
- Real HTTP test: 3,000 videos imported in ten batches, a further addition beyond the former cap, authenticated controls, full-lane search and paging, bounded compact responses, and restart recovery.
- Offline Chromium using a Python transport bridge to the real SQLite backend: 10,000 videos, 50 mounted queue rows, authenticated login, next-page navigation, finding Archive 9999, destination selection surviving live polls, moving to Next Rotation, pause and a seek to 840 seconds. No page errors. Browser loopback navigation itself was blocked by the build environment; no browser policy was altered.

## Local-disk benchmark

Node v22.16.0 on Linux. Synthetic metadata, same engine and filesystem for both storage adapters; five warm-up checkpoints followed by 50 measured committed checkpoints. SQLite uses WAL and synchronous FULL. The comparison uses the old JSON adapter under the uncapped engine, not an unmodified old application capable of loading 10,000 entries.

| Entries | JSON median checkpoint | SQLite median checkpoint | SQLite catalog rows per checkpoint |
| --- | --- | --- | --- |
| 2,000 | 1.946 ms | 0.306 ms | 0 |
| 5,000 | 2.931 ms | 0.302 ms | 0 |
| 10,000 | 4.818 ms | 0.390 ms | 0 |

In this fixture, a SQLite runtime checkpoint serialized 1,197 bytes at every library size. The compact dashboard poll was 1,348 bytes. A normal skip changed three catalog rows, rather than rewriting all remaining queue positions.

SQLite was not faster for every operation: at 10,000 entries the measured skip was 17.7 ms versus 10.6 ms for JSON, and open/reload was 52.5 ms versus 6.0 ms. The key improvement is bounded recurring checkpoint work and transactional row persistence, not a claim that all operations are faster. Full catalog mutations and startup still scale with library size. Filesystem caches, storage hardware and concurrent OBS/encoding load affect actual timings.

Reproduce with `npm run benchmark:storage`. Raw results: `test/performance-results/storage.json`. Browser checks: `test/performance-results/storage-ui.json`.

## Not verified locally

A real Windows desktop boot/migration, live YouTube extraction, OBS rendering/audio and Twitch connectivity were not exercised in this Linux container. The GitHub workflow runs the suite on Windows Node 22 and Ubuntu Node 22, with a separate Ubuntu Node 22.13.0 minimum-runtime job, and verifies the Windows yt-dlp binary before release. Consult the workflow run for its actual status; this report does not predeclare CI success.

10,000 is a tested queue size, not a new maximum or an assurance about arbitrary hardware. Back up the entire data directory before migration. Keep the database/WAL/SHM set together when moving an uncleanly stopped station; use the live backup command rather than copying a running main database alone.

## v1.3.1 additional regression coverage

- Unit tests cover 1,702-video chunking and increasing acknowledged progress; error and cancel behavior preserve untouched selections.
- Real HTTP + SQLite integration verifies a >500-ID request still fails safely, then 1,702 videos move in seven 250-ID batches and retain exact lane order after a database restart.
- Dashboard exposes Select all matching, a live `progress` element, status messages and Stop after current batch; no new queue schema changes.

- Offline Chromium simulation with synthetic responses verified that selecting 1,702 items, moving in seven batches, progress at each acknowledgement and reaching 100% work with the existing page controls. Direct browser access to loopback was blocked by the test environment.