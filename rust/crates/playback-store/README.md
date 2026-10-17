# playback-store

Local SQLite persistence for the Rust migration. Each channel is keyed by
`(tenant_id, channel_id)` and stores one current JSON snapshot, whose `revision`
must match the row revision. The crate deliberately has no dependency on the
playback engine; `playback-cli` supplies its pure transition function.

`apply_command` uses an immediate transaction to check command idempotency and
the expected revision, compute a transition, and commit the snapshot and receipt
together. Receipts keep the request and a small result rather than another full
queue snapshot. An exact retry returns the original receipt before comparing
the current channel revision. A changed request or expected revision using the
same ID is rejected. A no-op stores a receipt but leaves the snapshot, revision,
and snapshot timestamp unchanged.

WAL mode, `synchronous=FULL`, and a five-second busy timeout are configured for
writable stores. Use a local filesystem with SQLite's locking semantics. This
implementation is not a multi-host database, backup service, authentication
system, or proof of tenant authorization. Snapshots and command requests may
contain private operator data. `open_read_only` reads an existing initialized
database without creating or migrating one.

The caller's transition must not perform external side effects: a SQLite
transaction cannot atomically commit a network request or actual media output.
Future worker dispatch requires a durable outbox/acknowledgement design. Command
receipts currently remain indefinitely so old retry IDs cannot silently become
reusable; a hosted version needs an explicit retention and retry-window policy.
