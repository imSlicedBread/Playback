use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum CoreError {
    #[error("invalid entry: {0}")]
    InvalidEntry(String),
    #[error("entry ID is already present: {0}")]
    DuplicateEntryId(String),
    #[error("entry was not found in the queue: {0}")]
    EntryNotFound(String),
    #[error("no current video")]
    NoCurrentVideo,
    #[error("an active vote prevents this playback command")]
    VoteActive,
    #[error("no active vote")]
    NoActiveVote,
    #[error("no previous video")]
    NoPreviousVideo,
    #[error("new entries cannot be added directly to Recycled")]
    InvalidDestination,
    #[error("not enough queue space: requested {requested}, available {available}")]
    CapacityExceeded { requested: usize, available: usize },
    #[error("position or duration must be a finite number between 0 and 86400 seconds")]
    InvalidPosition,
    #[error("invalid queue selection: {0}")]
    InvalidSelection(String),
    #[error("invalid settings: {0}")]
    InvalidSettings(String),
    #[error("invalid state: {0}")]
    InvalidState(String),
    #[error("unsupported legacy state schema; expected schemaVersion 2")]
    UnsupportedLegacySchema,
    #[error("state counter or timestamp overflow")]
    CounterOverflow,
    #[error("vote choice must identify an available choice from 1 to 4")]
    InvalidVoteChoice,
    #[error("there are no upcoming videos to vote on")]
    NoVoteChoices,
    #[error("invalid viewer identity")]
    InvalidViewer,
    #[error("voting capacity reached")]
    VoteCapacity,
    #[error("skip voting is disabled")]
    SkipVotingDisabled,
    #[error("invalid playback observation: {0}")]
    InvalidObservation(String),
}
