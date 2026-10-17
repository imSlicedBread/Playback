//! Deterministic, persistence-independent channel transitions.
//!
//! The host supplies IDs, time, authentication, command deduplication and durable
//! storage. A transition never changes its input: persist the returned state
//! before replacing the live state or notifying a player. Playback checkpoints
//! report observed media progress; elapsed wall time never consumes a video.
//!
//! Queue semantics follow Playback v1.2.3. This crate is a migration foundation,
//! not a replacement for its HTTP server, player, editors or integrations.

mod engine;
mod error;
mod migration;
mod model;

pub use error::CoreError;
pub use migration::{import_v123, ImportReport};
pub use model::*;
