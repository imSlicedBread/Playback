# Playback v1.3.0 storage and capacity

## Capacity

There is no fixed total video limit across Play Next, Upcoming, Recycled and Next Rotation. The previous server cap was 2,000 entries (not 200); it has been removed, as has queue truncation during startup. Automated tests import and reload 10,000 entries. This is the tested size, not a new ceiling or a promise of unlimited hardware capacity.

The separate safety limits remain: 300 pasted videos per request, 500 playlist entries per extraction/import, 500 queue entries per server bulk-move request (automatically batched in the dashboard), 200 pending viewer suggestions, and 300 recent history events. Repeat import batches to grow the library. These limits do not limit the number of videos stored in the rotation queues. The dashboard still mounts 50 rows per page and searches the complete selected lane.

## Database

Production now stores its state in `data/playback.sqlite3` using Node's built-in SQLite module. No external database service, npm package, Python runtime or SQLite installer is needed. Node.js 22.13+ remains required.

- `station_state`: active video and timestamp, pause/mute/volume, generation, settings, voting state and revision.
- `queue_entries`: one row per durable queue-entry ID, with indexed lane, ordering position and YouTube video ID; per-video metadata is encoded in that row.
- `history_entries` and `suggestions`: independent rows, retaining the existing retention/moderation policies.
- `storage_meta`: initialization marker; `PRAGMA user_version` tracks the database schema separately from playback schema version 2.

Writes use transactions, WAL journaling and `synchronous=FULL`. A successful operator response follows the committed write. A failed transaction restores the prior durable engine state. Playhead, audio and ordinary settings saves serialize only the small station-state record: they do not enumerate or rewrite catalog rows. Catalog mutations are compared with cached rows and only changed rows are written. Stable ordering positions prevent a normal skip from rewriting every remaining entry.

The engine still holds the catalog in memory. Large catalog mutations still scan it, and a changed catalog is transferred to the dashboard. This is a 2,000+ storage upgrade, not an infinite-scale or multi-user hosting architecture. Slow disks and very large libraries require station-specific load testing. SQLite WAL files belong on a local filesystem, not a shared network folder.

## Automatic migration

1. Stop the previous Playback process, including its Windows startup task. Back up the complete `data/` directory.
2. Install v1.3.0 in the same location, preserving `data/`, launcher configuration and `tools/`.
3. On the first start, Playback reads the legacy JSON, normalizes existing playback settings, and saves an exact-byte backup named `state.before-sqlite-migration.json` before committing the database import.
4. Queue entries, their IDs and order, all four lanes, the active timestamp, audio, lower-third settings and voting countdown are retained. Larger queues are not sliced to 2,000.
5. The original `state.json` is left untouched. Once the database has committed, it is authoritative. Editing or restoring the old JSON alone will NOT update a migrated installation.

Malformed JSON, duplicate queue-entry identities, unsupported future schemas or corrupt SQLite storage cause startup to fail rather than silently replace a library with an empty one. Preserve the reported files and restore a known-good backup. Do not delete the database merely to suppress a startup error.

**Rollback:** v1.2.x cannot read the SQLite database. To roll back, stop Playback, preserve a copy of the entire current data directory, and restore the complete pre-upgrade backup into the old installation. Changes made after migration will not be present in that legacy backup.

## Backups after migration

From the Playback installation directory:

```sh
npm run backup
# Optional destination (must not already exist):
node ops/backup-storage.mjs /path/to/backup.sqlite3
```

The backup command uses SQLite's `VACUUM INTO` to produce a consistent snapshot, checks it, syncs it and then renames the completed output into place. It can run while the station is online. Keep copies of the separate token files and launcher configuration too; a database-only backup does not contain them.

For a full directory backup, stop Playback cleanly and copy the complete `data/` folder. **Never copy only `playback.sqlite3` while Playback is running.** The `-wal` file may contain committed changes not yet checkpointed into the main database. Do not remove WAL/SHM files from an active station.

To restore a database backup, stop Playback, archive the current complete data directory, and put the verified backup in a clean restore directory under the name `playback.sqlite3`, alongside copied token/config files. Do not mix an old database backup with unrelated `-wal`/`-shm` files. Point `DATA_DIR` at that directory or restore it to the expected location before restarting.

## Verification

Run `npm test` for migration, 10,000-video import/reload, row-level persistence, failure rollback, forced-process-termination recovery, backup integrity and real HTTP controls. Run `npm run benchmark:storage` for repeatable synthetic local-disk measurements. See `BUILD-REPORT.md` for the measured results and limitations.

Primary technical references: [Node SQLite API](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html), [SQLite WAL](https://sqlite.org/wal.html), [SQLite synchronous modes](https://sqlite.org/pragma.html#pragma_synchronous), [VACUUM INTO backup semantics](https://sqlite.org/lang_vacuum.html).