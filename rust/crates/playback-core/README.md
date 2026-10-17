# playback-core

A deterministic Rust migration core for Playback v1.2.3. It implements queue,
playback, rotation and voting transitions without a database, network, clock,
random-number generator or browser dependency.

This crate does **not** provide a hosted service, authentication, tenant isolation,
YouTube URL resolution, playlist fetching, Twitch integration, overlay rendering,
video decoding, encoding or an outgoing broadcast. The host must supply those
capabilities and authorize commands before calling the engine.

## Transaction contract

```rust
use playback_core::{Command, EngineState};

let state = EngineState::new(1_000);
let candidate = state.transition(Command::SetLoop { enabled: false }, 2_000)?;
// Persist candidate.state before publishing it or notifying an output.
# Ok::<(), playback_core::CoreError>(())
```

`transition` leaves the input untouched, including on validation failure. A
successful change advances `revision` exactly once. Stale observations and
same-value no-ops preserve the entire snapshot and revision.

The persistence layer must atomically check the expected revision, save the
candidate and record a command receipt. Repeating `Skip` without host-level
idempotency would skip another video. Channel-owner leases and output fencing
also belong to the host; the playback generation is not a media-worker lease.

This first implementation stages a cloned snapshot to make failed transitions
safe. It is a correctness foundation, not a measured capacity or efficiency
claim. Hosts should use bounded checkpoint frequency rather than call it for
every rendered video frame.

## Queue behavior

The active entry is separate from the four waiting lanes:

| State field | Meaning |
| --- | --- |
| `queue` | Upcoming entries in the current rotation |
| `priorityQueue` | FIFO Play Next entries, ahead of Upcoming |
| `recycledQueue` | Consumed entries retained for a future rotation |
| `nextRotationQueue` | New entries explicitly deferred to the next rotation |

When the playable lanes are empty and looping is enabled, deferred entries lead
the next rotation, followed by recycled entries. New imports do not reorder the
existing queue by publication date. Capacity includes current and all four lanes
and is limited to 2,000 entries; history retains the latest 300 records.

Play Now restarts the selected entry and parks the interrupted current entry at
the front of Play Next with its saved position. The interrupted entry resumes
afterward. Unavailable entries go to history and never enter Recycled.

End voting preserves v1.2.3's order of operations: when needed, it promotes the
existing recycled/deferred pool before offering candidates and before consuming
the current entry. The current entry remains paused during the round. Ballots
can change, ties select the earliest eligible choice, and removing a candidate
invalidates its ballots. Owner Skip does not require viewer votes.

Two deliberate robustness differences are covered by regression tests:

- Previous on a one-entry loop keeps one stable entry ID, avoiding the legacy
  duplication of an entry that is both current and the latest history record.
- Old history keys copied into current by legacy Previous are replaced before
  new history serialization, avoiding duplicate JSON fields.

## Command JSON

Commands use `action` in snake case and fields in camel case. Unknown command
fields are rejected. The host supplies stable entry IDs; repeated YouTube video
IDs are allowed when their queue-entry IDs differ.

```json
{
  "action": "add",
  "entry": {
    "id": "entry-2026-001",
    "videoId": "aqz-KE-bpKQ",
    "title": "Newly added video"
  },
  "destination": "playNext"
}
```

New-entry destinations are `current`, `playNext` and `nextRotation`. Existing
entries can also be moved to `recycled`.

```json
{"action":"move","id":"entry-2026-001","destination":"nextRotation"}
```

```json
{"action":"play_now","id":"entry-2026-001"}
```

```json
{"action":"pause","paused":true}
```

```json
{"action":"seek","position":1234.5}
```

```json
{"action":"skip"}
```

Positions and durations are seconds. The core accepts resolved eleven-character
YouTube IDs, not arbitrary URLs. `bulk_add` accepts up to 300 supplied entries;
`import_playlist` accepts up to 500 with `skipDuplicates` and `order` options.
That command imports supplied metadata; it does not fetch a playlist.

## Observations and recovery

```json
{
  "action":"checkpoint",
  "generation":7,
  "entryId":"entry-2026-001",
  "sequence":42,
  "position":1234.5,
  "duration":3600,
  "observedState":"buffering"
}
```

The host must authenticate the output and verify its ownership before accepting
this command. Both entry ID and generation must match current playback.
Checkpoint sequences must increase within a generation. Seek, replay, activation
and a changed pause state invalidate previous observations.

`current.paused` expresses the desired pause state; `lastObservation` records what
the output reported. Buffering, blocked autoplay and elapsed downtime do not
advance the saved media position. An end or failure report uses the same guard:

```json
{"action":"ended","generation":7,"entryId":"entry-2026-001"}
```

```json
{"action":"unavailable","generation":7,"entryId":"entry-2026-001"}
```

The engine does not invent elapsed playback from `now_ms`. Vote countdowns
advance only through sequenced `elapse_vote` commands. A host scheduler should
measure running time with a monotonic clock and should not consume shutdown time.

## Importing an existing save

`import_v123(source: serde_json::Value, now_ms)` accepts schema 2 and returns
`ImportReport { state, source, warnings }`. Native state uses schema 3.

Import preserves existing IDs, lanes, fractional playback position, pause state,
vote countdown, known playback settings and opaque UI/integration fields. Missing
entry IDs receive deterministic import IDs with warnings. Malformed, duplicate
active IDs and over-capacity queues fail as a whole instead of silently dropping
content. Older schemas require a separate, explicit migration.

`source` is the unmodified **parsed** source document. Keep a private copy of the
original input file if byte-for-byte backup is needed. The source and native
opaque settings can contain private integration data or viewer identifiers;
neither is a public-channel response format. Layout and integration fields are
preserved for later adapters, not validated or implemented by this crate.

Run the crate's migration, rotation, recovery and stale-event regressions from
the Rust workspace with `cargo test -p playback-core`.
