# fKey Playback — Rust migration

This workspace implements the first part of the Playback Cloud migration: a
deterministic channel engine, durable local state, and a native migration/control
tool. It follows the existing v1.2.3 queue behavior and imports schema-2 saved
state into a separate SQLite database.

The existing Node application is the usable local player. This Rust milestone
does not yet serve its dashboard, authenticate hosted customers, render video,
connect Twitch, or send a cloud livestream. The full product design and launch
requirements are in [Playback Cloud](../docs/PLAYBACK-CLOUD.md).

## Workspace

| Crate | Responsibility |
| --- | --- |
| [`playback-core`](crates/playback-core/README.md) | Four queue lanes, rotation, playback controls, observations, voting, migration |
| [`playback-store`](crates/playback-store/README.md) | SQLite snapshots, atomic command receipts, revisions, safe retries |
| [`playback-cli`](crates/playback-cli/README.md) | Explicit initialization/import, safe state inspection, command application |

The engine has no network, database, timer, or runtime dependency. Hosts supply
time, stable IDs and authenticated observations. A failed transition leaves the
input unchanged. The store commits a candidate snapshot and its receipt before a
host may acknowledge or publish the change.

## Build and exercise the synthetic migration

Install the Rust toolchain and a supported native C toolchain; SQLite is compiled
from the bundled source. The repository pins Rust 1.90.0 and commits Cargo.lock.
Run these commands from this directory:

```sh
cargo test --workspace --locked
cargo build --release --locked -p playback-cli
```

The binary is `target/release/playback` on Unix or
`target/release/playback.exe` on Windows. These `cargo run` commands also work
without adding the binary to PATH:

```sh
cargo run --locked -p playback-cli -- --db demo.sqlite3 --tenant demo --channel archive import-v123 --source fixtures/v1.2.3-sanitized.json
cargo run --locked -p playback-cli -- --db demo.sqlite3 --tenant demo --channel archive show --entries
cargo run --locked -p playback-cli -- --db demo.sqlite3 --tenant demo --channel archive apply --command-id skip-001 --expected-revision 13 --command '{"action":"skip"}'
```

The fixture was generated with the actual v1.2.3 JavaScript engine. It contains
synthetic entries spanning all four lanes, two history records, and a paused
current video at 1,234.5 seconds. It contains no customer credentials. Source
revision 13 becomes 14 after the example Skip. Repeating the same command with
the same ID, expected revision and JSON returns its saved receipt and does not
skip again. Use `--command-file` if your shell handles inline JSON differently.

To migrate an installation, make a consistent private copy of its `state.json`
and use a new channel/database. Import and initialization refuse to overwrite a
channel. The importer never writes the source. Unknown settings and metadata can
remain in the private migrated database; CLI output only exposes known fields.
Inspect the migration before connecting any replacement runtime.

`--tenant` and `--channel` are storage namespaces for this local tool. The future
service must derive access from authenticated fKey Account identity, rather than
trusting those names as permission to access a channel.

## Compatibility and recovery

- Play Next remains FIFO ahead of Upcoming. Consumed content stays in Recycled
  until a rotation finishes; Next Rotation leads the promoted pool.
- Play Now parks the interrupted entry with its confirmed position. It resumes
  after the requested entry.
- Playback generation and entry ID reject delayed end/error events. Increasing
  observation sequence numbers reject old checkpoints within a generation.
- Recovery uses confirmed media progress. The core does not treat downtime or
  buffering as successful playback.
- Manual and automatic voting, changed ballots, cancellation, skip voting, and
  the existing rotation boundary behavior are preserved.
- Previous deliberately fixes a legacy single-item-loop duplicate-ID case and
  avoids duplicating old history keys when the replayed entry completes again.

Checkpoints do not establish media-worker ownership. Authentication and worker
leases/fencing remain service responsibilities. SQLite FULL synchronization and
WAL establish the local transaction contract; operational durability also
depends on the filesystem and storage honoring synchronization requests.

## Verification

The Rust tests cover migration, controls, queue boundaries, stale observations,
vote recovery, source preservation, process-to-process retries, simultaneous
writers, and rollback after a deliberately failed receipt write. An abrupt-exit
test exercises a committed write without running normal process destructors.

An explicit cross-engine harness compares public queue state with the actual
JavaScript engine after import, interruption/resumption, rollover, voting,
unavailable media and delayed events. Build the debug CLI first, then run:

```sh
cargo build --locked -p playback-cli
node verification/node-parity.mjs
```

Set `PLAYBACK_RUST_BIN` to an absolute executable path to check a release build.
The harness uses temporary synthetic data and cleans it up. Its filename stays
outside Node's automatic test discovery so the current release's `npm test`
does not require Rust. The separate Rust CI workflow runs on Ubuntu and Windows.

The existing application's verification remains:

```sh
npm --prefix .. run check
npm --prefix .. test
```

## Efficiency and next integration

This milestone stages complete state snapshots to preserve atomic failure and
migration semantics. Its throughput is measured separately from disk durability,
network traffic, and media processing. It does not establish cloud capacity or
a percentage speed improvement.

The hosted adapter should keep channel updates small, paginate queue data, bound
background work, and send realtime changes after durable commits. Continuous
cloud output needs a separate media worker and output supervision. See the
[architecture and acceptance criteria](../docs/PLAYBACK-CLOUD.md) for the service,
identity, authorized media, recovery, and usage-metering work.
