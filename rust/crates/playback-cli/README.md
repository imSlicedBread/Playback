# Playback migration CLI

This executable is the first Rust queue/persistence slice. It is an offline tool:
it does not serve the existing dashboard, authenticate users, play YouTube videos,
or produce an outgoing cloud livestream.

Run commands from the `rust` directory. Every invocation specifies the database,
tenant, and channel explicitly. The database's parent directory must exist.

```sh
cargo run -p playback-cli -- --db /tmp/playback.sqlite3 --tenant demo --channel archive init
cargo run -p playback-cli -- --db /tmp/playback.sqlite3 --tenant demo --channel archive show
```

Use a new channel when importing. Stop or copy a consistent snapshot from the
existing player, preserve that copy privately, and pass its path explicitly:

```sh
cargo run -p playback-cli -- --db /tmp/playback.sqlite3 --tenant demo --channel imported import-v123 --source /absolute/path/state-copy.json
cargo run -p playback-cli -- --db /tmp/playback.sqlite3 --tenant demo --channel imported show --entries
```

`init` and `import-v123` refuse to replace an existing channel. The importer opens
the source only for reading, rejects a source that aliases the database, and makes
no automatic raw-state export. The migrated database can retain private operator
settings; protect it as carefully as the original state file. New database files
receive mode `0600` on Unix. Windows installations should use an appropriately
restricted directory/ACL. The JSON printed by `show` and its `state` alias contains
counts and known entry fields, without raw settings, ballots, or source data.

## Apply a command

Read the revision from `show`. Supply that revision and a unique command ID with
the JSON command. For an imported channel at revision 13:

```sh
cargo run -p playback-cli -- --db /tmp/playback.sqlite3 --tenant demo --channel imported apply --command-id skip-001 --expected-revision 13 --command '{"action":"skip"}'
```

Use `--command-file /absolute/path/command.json` instead of inline JSON when the
shell's quoting rules make it more convenient. Command schemas come from
`playback-core`. Examples include:

```json
{"action":"pause","paused":true}
```

```json
{"action":"seek","position":120.5}
```

```json
{"action":"move","id":"existing-entry-id","destination":"playNext"}
```

An exact retry uses the **same command ID, JSON content, and expected revision**.
It returns the original receipt with `replayed: true`, even if later commands have
advanced the state. Reusing that ID for another request fails. A new command with
an out-of-date revision fails without changing the channel. Rejected commands do
not consume IDs. Ignored stale playback events can produce durable receipts
without incrementing the state revision.

## Verification

```sh
cargo test -p playback-store -p playback-cli
```

The tests exercise retry/reopen behavior, failure between snapshot and receipt
writes, competing writers, namespace separation, source preservation, refusal to
overwrite a channel, and omission of private fields from CLI output. The fixture
is synthetic and contains no customer credentials.
