use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::CoreError;

pub const CORE_SCHEMA_VERSION: u32 = 3;
pub const MAX_QUEUE: usize = 2_000;
pub const MAX_HISTORY: usize = 300;
pub const MAX_BALLOTS: usize = 20_000;
pub const MAX_MEDIA_SECONDS: f64 = 86_400.0;

/// A stable queue identity, distinct from its YouTube video ID. The same video
/// can be present more than once when each occurrence has a different `id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub video_id: String,
    pub title: String,
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: f64,
    #[serde(default)]
    pub paused: bool,
    #[serde(default)]
    pub play_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub added_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_played_rotation: Option<u64>,
    /// Provider metadata is retained, without being trusted as engine control.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Entry {
    /// Accepts an already resolved, eleven-character YouTube ID. URL parsing
    /// and network metadata resolution belong to the host/integration layer.
    pub fn new(
        id: impl Into<String>,
        video_id: impl Into<String>,
        title: impl Into<String>,
    ) -> Result<Self, CoreError> {
        let id = id.into();
        let video_id = video_id.into();
        let title = title.into().trim().to_owned();
        let entry = Self {
            id,
            title: if title.is_empty() {
                format!("YouTube · {video_id}")
            } else {
                title
            },
            video_id,
            position: 0.0,
            duration: 0.0,
            paused: false,
            play_count: 0,
            added_at: None,
            published_at: None,
            last_played_at: None,
            last_played_rotation: None,
            extra: Map::new(),
        };
        entry.validate()?;
        Ok(entry)
    }

    pub fn validate(&self) -> Result<(), CoreError> {
        if !valid_identity(&self.id, 128) {
            return Err(CoreError::InvalidEntry("invalid stable entry ID".into()));
        }
        if self.video_id.len() != 11
            || !self
                .video_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        {
            return Err(CoreError::InvalidEntry(format!(
                "{} has an invalid YouTube video ID",
                self.id
            )));
        }
        // JavaScript's length limit counts UTF-16 code units.
        if self.title.trim().is_empty()
            || self.title.encode_utf16().count() > 180
            || self.title.chars().any(is_control)
        {
            return Err(CoreError::InvalidEntry(format!(
                "{} has an invalid title",
                self.id
            )));
        }
        validate_media_time(self.position)?;
        validate_media_time(self.duration)?;
        for key in [
            "id",
            "videoId",
            "title",
            "position",
            "duration",
            "paused",
            "playCount",
            "addedAt",
            "publishedAt",
            "lastPlayedAt",
            "lastPlayedRotation",
        ] {
            if self.extra.contains_key(key) {
                return Err(CoreError::InvalidEntry(format!(
                    "metadata shadows reserved field {key}"
                )));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Destination {
    #[default]
    Current,
    PlayNext,
    NextRotation,
    Recycled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PlaylistOrder {
    #[default]
    Original,
    Oldest,
    Newest,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CompletionReason {
    Completed,
    Skipped,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    #[serde(flatten)]
    pub entry: Entry,
    pub reason: CompletionReason,
    pub played_at: String,
    pub rotation_number: u64,
    #[serde(default)]
    pub unavailable: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PlaybackSettings {
    #[serde(rename = "loop")]
    pub loop_enabled: bool,
    pub vote_on_end: bool,
    pub vote_seconds: u32,
    pub skip_voting: bool,
    pub skip_threshold: usize,
    /// UI/layout/integration settings are preserved, not validated or rendered
    /// by this queue core. Do not expose this map to untrusted viewer clients.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for PlaybackSettings {
    fn default() -> Self {
        Self {
            loop_enabled: true,
            vote_on_end: true,
            vote_seconds: 20,
            skip_voting: true,
            skip_threshold: 3,
            extra: Map::new(),
        }
    }
}

impl PlaybackSettings {
    pub fn validate(&self) -> Result<(), CoreError> {
        if !(5..=120).contains(&self.vote_seconds) {
            return Err(CoreError::InvalidSettings(
                "voteSeconds must be 5–120".into(),
            ));
        }
        if !(1..=100).contains(&self.skip_threshold) {
            return Err(CoreError::InvalidSettings(
                "skipThreshold must be 1–100".into(),
            ));
        }
        if [
            "loop",
            "voteOnEnd",
            "voteSeconds",
            "skipVoting",
            "skipThreshold",
        ]
        .iter()
        .any(|key| self.extra.contains_key(*key))
        {
            return Err(CoreError::InvalidSettings(
                "metadata shadows a playback setting".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Audio {
    pub volume: u8,
    pub muted: bool,
}

impl Default for Audio {
    fn default() -> Self {
        Self {
            volume: 100,
            muted: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoteRound {
    pub id: String,
    pub choices: Vec<Option<String>>,
    pub remaining: f64,
    #[serde(default)]
    pub ballots: BTreeMap<String, u8>,
    pub manual: bool,
    pub was_paused: bool,
    /// A scheduler supplies monotonically increasing ticks for this round.
    #[serde(default)]
    pub last_tick_sequence: u64,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservedState {
    Unstarted,
    Cued,
    Playing,
    Paused,
    Buffering,
    Ended,
    Blocked,
}

/// A trusted output observation. Its position is not inferred from elapsed
/// wall time. `Entry::paused` remains the operator's desired pause state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackObservation {
    pub generation: u64,
    pub entry_id: String,
    pub sequence: u64,
    pub position: f64,
    pub observed_state: ObservedState,
    pub recorded_at_ms: u64,
}

/// Native schema 3. Unknown legacy fields are retained for migration, not
/// interpreted as authorization or supported feature implementations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineState {
    pub schema_version: u32,
    pub revision: u64,
    pub layout_revision: u64,
    pub rotation_number: u64,
    pub current: Option<Entry>,
    pub queue: Vec<Entry>,
    pub priority_queue: Vec<Entry>,
    pub recycled_queue: Vec<Entry>,
    pub next_rotation_queue: Vec<Entry>,
    pub history: Vec<HistoryEntry>,
    pub vote: Option<VoteRound>,
    pub skip_ballots: BTreeMap<String, bool>,
    pub suggestions: Vec<Value>,
    pub settings: PlaybackSettings,
    pub audio: Audio,
    pub updated_at: String,
    pub generation: u64,
    #[serde(default)]
    pub last_observation: Option<PlaybackObservation>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// Commands contain no random data or implicit clock reads. The host must
/// authorize them and fence the active output before accepting observations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Add {
        entry: Entry,
        #[serde(default)]
        destination: Destination,
    },
    AddNow {
        entry: Entry,
    },
    BulkAdd {
        entries: Vec<Entry>,
        #[serde(default)]
        destination: Destination,
    },
    ImportPlaylist {
        entries: Vec<Entry>,
        #[serde(default)]
        destination: Destination,
        #[serde(default = "default_true")]
        skip_duplicates: bool,
        #[serde(default)]
        order: PlaylistOrder,
    },
    PlayNow {
        id: String,
    },
    Move {
        id: String,
        destination: Destination,
    },
    MoveMany {
        ids: Vec<String>,
        destination: Destination,
    },
    Remove {
        id: String,
    },
    Reorder {
        id: String,
        to: usize,
    },
    /// The caller chooses a shuffle/permutation; the core verifies membership.
    OrderUpcoming {
        ids: Vec<String>,
    },
    Skip,
    Ended {
        generation: u64,
        entry_id: String,
    },
    Unavailable {
        generation: u64,
        entry_id: String,
    },
    Pause {
        paused: bool,
    },
    Seek {
        position: f64,
    },
    Replay,
    Previous,
    Checkpoint {
        generation: u64,
        entry_id: String,
        sequence: u64,
        position: f64,
        #[serde(default)]
        duration: Option<f64>,
        observed_state: ObservedState,
    },
    SetLoop {
        enabled: bool,
    },
    SetVoteOnEnd {
        enabled: bool,
    },
    SetAudio {
        volume: u8,
        muted: bool,
    },
    StartVote {
        vote_id: String,
    },
    CancelVote,
    VoteChoice {
        index: usize,
        viewer: String,
    },
    Choose {
        index: usize,
    },
    ConcludeVote,
    ElapseVote {
        vote_id: String,
        seconds: u32,
        sequence: u64,
    },
    SkipVote {
        viewer: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IgnoreReason {
    NoCurrentVideo,
    VoteActive,
    StaleGeneration,
    DifferentEntry,
    StaleObservation,
    StaleVote,
    NoChange,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    pub state: EngineState,
    pub changed: bool,
    pub ignored: Option<IgnoreReason>,
}

pub(crate) fn default_true() -> bool {
    true
}

pub(crate) fn is_control(c: char) -> bool {
    c <= '\u{001f}' || c == '\u{007f}'
}

pub(crate) fn valid_identity(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.len() <= limit && !value.chars().any(is_control)
}

pub(crate) fn validate_media_time(value: f64) -> Result<(), CoreError> {
    if value.is_finite() && (0.0..=MAX_MEDIA_SECONDS).contains(&value) {
        Ok(())
    } else {
        Err(CoreError::InvalidPosition)
    }
}
