use std::collections::{BTreeMap, BTreeSet};

use serde_json::Map;

use crate::{model::*, CoreError};

impl EngineState {
    pub fn new(now_ms: u64) -> Self {
        Self {
            schema_version: CORE_SCHEMA_VERSION,
            revision: 1,
            layout_revision: 1,
            rotation_number: 1,
            current: None,
            queue: Vec::new(),
            priority_queue: Vec::new(),
            recycled_queue: Vec::new(),
            next_rotation_queue: Vec::new(),
            history: Vec::new(),
            vote: None,
            skip_ballots: BTreeMap::new(),
            suggestions: Vec::new(),
            settings: PlaybackSettings::default(),
            audio: Audio::default(),
            updated_at: timestamp(now_ms),
            generation: 1,
            last_observation: None,
            extra: Map::new(),
        }
    }

    /// Stage a complete transition without changing the caller's snapshot.
    /// The caller must durably commit `state` before publishing it. Exactly one
    /// revision is consumed by a change; stale observations consume none.
    pub fn transition(&self, command: Command, now_ms: u64) -> Result<Transition, CoreError> {
        self.validate()?;
        let mut state = self.clone();
        let ignored = state.apply(command, now_ms)?;
        let changed = state != *self;
        if changed {
            state.revision = self
                .revision
                .checked_add(1)
                .ok_or(CoreError::CounterOverflow)?;
            state.updated_at = timestamp(now_ms);
            state.validate()?;
        }
        Ok(Transition {
            state,
            changed,
            ignored: ignored.or(if changed {
                None
            } else {
                Some(IgnoreReason::NoChange)
            }),
        })
    }

    pub fn queued_count(&self) -> usize {
        self.queue.len()
            + self.priority_queue.len()
            + self.recycled_queue.len()
            + self.next_rotation_queue.len()
    }

    pub fn stored_count(&self) -> usize {
        self.queued_count() + usize::from(self.current.is_some())
    }

    pub fn available_capacity(&self) -> usize {
        MAX_QUEUE.saturating_sub(self.stored_count())
    }

    /// Play Next is a FIFO priority lane ahead of Upcoming. It does not reorder
    /// Upcoming or make deferred/recycled entries immediately eligible.
    pub fn playable(&self) -> impl Iterator<Item = &Entry> {
        self.priority_queue.iter().chain(self.queue.iter())
    }

    pub fn lane(&self, destination: Destination) -> &[Entry] {
        match destination {
            Destination::Current => &self.queue,
            Destination::PlayNext => &self.priority_queue,
            Destination::Recycled => &self.recycled_queue,
            Destination::NextRotation => &self.next_rotation_queue,
        }
    }

    pub fn vote_counts(&self) -> [usize; 4] {
        let mut counts = [0; 4];
        if let Some(vote) = &self.vote {
            let eligible: BTreeSet<_> = self.playable().map(|entry| entry.id.as_str()).collect();
            for &index in vote.ballots.values() {
                if let Some(Some(id)) = vote.choices.get(usize::from(index)) {
                    if eligible.contains(id.as_str()) && usize::from(index) < counts.len() {
                        counts[usize::from(index)] += 1;
                    }
                }
            }
        }
        counts
    }

    /// Validate a deserialized snapshot before it becomes authoritative.
    pub fn validate(&self) -> Result<(), CoreError> {
        if self.schema_version != CORE_SCHEMA_VERSION {
            return Err(CoreError::InvalidState(
                "unsupported native schema version".into(),
            ));
        }
        if self.revision == 0
            || self.generation == 0
            || self.rotation_number == 0
            || self.layout_revision == 0
        {
            return Err(CoreError::InvalidState(
                "state counters must be positive".into(),
            ));
        }
        self.settings.validate()?;
        if self.audio.volume > 100 || (self.audio.volume == 0 && !self.audio.muted) {
            return Err(CoreError::InvalidState("invalid audio settings".into()));
        }
        if self.stored_count() > MAX_QUEUE {
            return Err(CoreError::CapacityExceeded {
                requested: self.stored_count(),
                available: MAX_QUEUE,
            });
        }
        let mut ids = BTreeSet::new();
        for entry in self.current.iter().chain(self.all_queued()) {
            entry.validate()?;
            if !ids.insert(entry.id.as_str()) {
                return Err(CoreError::DuplicateEntryId(entry.id.clone()));
            }
        }
        if self.history.len() > MAX_HISTORY {
            return Err(CoreError::InvalidState(
                "history exceeds its retention limit".into(),
            ));
        }
        for item in &self.history {
            item.entry.validate()?;
            if item.rotation_number == 0 {
                return Err(CoreError::InvalidState(
                    "history rotation must be positive".into(),
                ));
            }
            if ["reason", "playedAt", "rotationNumber", "unavailable"]
                .iter()
                .any(|key| item.entry.extra.contains_key(*key))
            {
                return Err(CoreError::InvalidState(
                    "entry metadata shadows a history field".into(),
                ));
            }
        }
        if self.skip_ballots.len() > MAX_BALLOTS {
            return Err(CoreError::VoteCapacity);
        }
        if let Some(vote) = &self.vote {
            if self.current.is_none()
                || !valid_identity(&vote.id, 128)
                || vote.choices.is_empty()
                || vote.choices.len() > 4
                || !vote.remaining.is_finite()
                || !(0.0..=120.0).contains(&vote.remaining)
            {
                return Err(CoreError::InvalidState("invalid active vote".into()));
            }
            let eligible: BTreeSet<_> = self.playable().map(|entry| entry.id.as_str()).collect();
            let mut choices = BTreeSet::new();
            for id in vote.choices.iter().flatten() {
                if !eligible.contains(id.as_str()) || !choices.insert(id.as_str()) {
                    return Err(CoreError::InvalidState(
                        "vote references an unavailable or repeated entry".into(),
                    ));
                }
            }
            if vote.ballots.len() > MAX_BALLOTS {
                return Err(CoreError::VoteCapacity);
            }
            if [
                "id",
                "choices",
                "remaining",
                "ballots",
                "manual",
                "wasPaused",
                "lastTickSequence",
            ]
            .iter()
            .any(|key| vote.extra.contains_key(*key))
            {
                return Err(CoreError::InvalidState(
                    "metadata shadows a vote field".into(),
                ));
            }
            for (viewer, &index) in &vote.ballots {
                if !valid_identity(viewer, 256)
                    || !matches!(vote.choices.get(usize::from(index)), Some(Some(_)))
                {
                    return Err(CoreError::InvalidState("invalid vote ballot".into()));
                }
            }
        }
        if let Some(observation) = &self.last_observation {
            validate_media_time(observation.position)?;
            if observation.generation != self.generation
                || observation.sequence == 0
                || self.current.as_ref().map(|entry| &entry.id) != Some(&observation.entry_id)
            {
                return Err(CoreError::InvalidState(
                    "observation does not identify current playback".into(),
                ));
            }
        }
        for key in [
            "schemaVersion",
            "revision",
            "layoutRevision",
            "rotationNumber",
            "current",
            "queue",
            "priorityQueue",
            "recycledQueue",
            "nextRotationQueue",
            "history",
            "vote",
            "skipBallots",
            "suggestions",
            "settings",
            "audio",
            "updatedAt",
            "generation",
            "lastObservation",
        ] {
            if self.extra.contains_key(key) {
                return Err(CoreError::InvalidState(format!(
                    "metadata shadows reserved field {key}"
                )));
            }
        }
        Ok(())
    }

    fn apply(&mut self, command: Command, now_ms: u64) -> Result<Option<IgnoreReason>, CoreError> {
        match command {
            Command::Add { entry, destination } => {
                self.add_many(vec![entry], destination, now_ms)?
            }
            Command::AddNow { entry } => {
                let entry = self.prepare_new(entry, now_ms)?;
                self.ensure_new_entries(std::slice::from_ref(&entry))?;
                self.park_current();
                let id = entry.id.clone();
                self.queue.insert(0, entry);
                self.activate_by_id(&id)?;
            }
            Command::BulkAdd {
                entries,
                destination,
            } => {
                if entries.len() > 300 {
                    return Err(CoreError::InvalidSelection(
                        "import up to 300 entries at a time".into(),
                    ));
                }
                self.add_many(entries, destination, now_ms)?;
            }
            Command::ImportPlaylist {
                entries,
                destination,
                skip_duplicates,
                order,
            } => {
                if entries.len() > 500 {
                    return Err(CoreError::InvalidSelection(
                        "import up to 500 playlist entries at a time".into(),
                    ));
                }
                if destination == Destination::Recycled {
                    return Err(CoreError::InvalidDestination);
                }
                let mut seen: BTreeSet<String> = if skip_duplicates {
                    self.current
                        .iter()
                        .chain(self.all_queued())
                        .map(|entry| entry.video_id.clone())
                        .collect()
                } else {
                    BTreeSet::new()
                };
                let mut prepared = Vec::new();
                for entry in entries {
                    let entry = self.prepare_new(entry, now_ms)?;
                    if skip_duplicates && !seen.insert(entry.video_id.clone()) {
                        continue;
                    }
                    prepared.push(entry);
                }
                if order != PlaylistOrder::Original {
                    prepared.sort_by(|a, b| match (&a.published_at, &b.published_at) {
                        (None, None) => std::cmp::Ordering::Equal,
                        (None, Some(_)) => std::cmp::Ordering::Greater,
                        (Some(_), None) => std::cmp::Ordering::Less,
                        (Some(a), Some(b)) => {
                            if order == PlaylistOrder::Oldest {
                                a.cmp(b)
                            } else {
                                b.cmp(a)
                            }
                        }
                    });
                }
                self.append_prepared(prepared, destination)?;
            }
            Command::PlayNow { id } => {
                self.find_entry(&id)
                    .ok_or_else(|| CoreError::EntryNotFound(id.clone()))?;
                self.park_current();
                let (lane, index) = self
                    .find_entry(&id)
                    .ok_or_else(|| CoreError::EntryNotFound(id.clone()))?;
                let mut entry = self.lane_mut(lane).remove(index);
                entry.position = 0.0;
                entry.paused = false;
                self.priority_queue.insert(0, entry);
                self.activate_by_id(&id)?;
            }
            Command::Move { id, destination } => self.move_entries(vec![id], destination)?,
            Command::MoveMany { ids, destination } => self.move_entries(ids, destination)?,
            Command::Remove { id } => {
                let (lane, index) = self
                    .find_entry(&id)
                    .ok_or_else(|| CoreError::EntryNotFound(id.clone()))?;
                self.lane_mut(lane).remove(index);
                self.invalidate_vote_entry(&id);
            }
            Command::Reorder { id, to } => {
                let (lane, index) = self
                    .find_entry(&id)
                    .ok_or_else(|| CoreError::EntryNotFound(id.clone()))?;
                if to >= self.lane(lane).len() {
                    return Err(CoreError::InvalidSelection(
                        "invalid destination position".into(),
                    ));
                }
                let entry = self.lane_mut(lane).remove(index);
                self.lane_mut(lane).insert(to, entry);
            }
            Command::OrderUpcoming { ids } => {
                let requested: BTreeSet<_> = ids.iter().map(String::as_str).collect();
                let existing: BTreeSet<_> =
                    self.queue.iter().map(|entry| entry.id.as_str()).collect();
                if ids.len() != self.queue.len()
                    || requested != existing
                    || requested.len() != ids.len()
                {
                    return Err(CoreError::InvalidSelection(
                        "order must contain every Upcoming entry exactly once".into(),
                    ));
                }
                let mut entries: BTreeMap<_, _> = std::mem::take(&mut self.queue)
                    .into_iter()
                    .map(|entry| (entry.id.clone(), entry))
                    .collect();
                self.queue = ids
                    .into_iter()
                    .map(|id| {
                        entries
                            .remove(&id)
                            .expect("membership was checked before moving entries")
                    })
                    .collect();
            }
            Command::Skip => self.skip(now_ms)?,
            Command::Ended {
                generation,
                entry_id,
            } => {
                if let Some(reason) = self.observation_guard(generation, &entry_id) {
                    return Ok(Some(reason));
                }
                if self.settings.vote_on_end {
                    self.promote_next_rotation()?;
                    if self.playable().next().is_some() {
                        let vote_id = format!(
                            "vote-{}-{}",
                            self.generation,
                            self.revision
                                .checked_add(1)
                                .ok_or(CoreError::CounterOverflow)?
                        );
                        self.start_vote(vote_id, true)?;
                        return Ok(None);
                    }
                }
                self.rotate_current(CompletionReason::Completed, now_ms)?;
                self.activate_first()?;
            }
            Command::Unavailable {
                generation,
                entry_id,
            } => {
                if let Some(reason) = self.observation_guard(generation, &entry_id) {
                    return Ok(Some(reason));
                }
                self.rotate_current(CompletionReason::Unavailable, now_ms)?;
                self.activate_first()?;
            }
            Command::Pause { paused } => {
                self.require_playing()?;
                if self
                    .current
                    .as_ref()
                    .is_some_and(|entry| entry.paused != paused)
                {
                    self.current.as_mut().expect("current was checked").paused = paused;
                    self.bump_generation()?;
                }
            }
            Command::Seek { position } => {
                self.require_playing()?;
                validate_media_time(position)?;
                let entry = self.current.as_mut().expect("current was checked");
                entry.position = if entry.duration > 0.0 {
                    position.min(entry.duration)
                } else {
                    position
                };
                self.bump_generation()?;
            }
            Command::Replay => {
                let entry = self.current.as_mut().ok_or(CoreError::NoCurrentVideo)?;
                entry.position = 0.0;
                entry.paused = false;
                self.vote = None;
                self.skip_ballots.clear();
                self.bump_generation()?;
            }
            Command::Previous => {
                let last = self.history.pop().ok_or(CoreError::NoPreviousVideo)?;
                if let Some((lane, index)) = self.find_entry(&last.entry.id) {
                    self.lane_mut(lane).remove(index);
                }
                // A one-item loop can leave the same ID current and in history.
                // Preserve one stable entry rather than duplicating that ID.
                if self
                    .current
                    .as_ref()
                    .is_some_and(|entry| entry.id == last.entry.id)
                {
                    self.current = None;
                } else {
                    self.park_current();
                }
                let mut entry = last.entry;
                entry.position = 0.0;
                entry.paused = false;
                self.current = Some(entry);
                self.vote = None;
                self.skip_ballots.clear();
                self.bump_generation()?;
            }
            Command::Checkpoint {
                generation,
                entry_id,
                sequence,
                position,
                duration,
                observed_state,
            } => {
                if let Some(reason) = self.observation_guard(generation, &entry_id) {
                    return Ok(Some(reason));
                }
                if sequence == 0 {
                    return Err(CoreError::InvalidObservation(
                        "sequence must be positive".into(),
                    ));
                }
                if self
                    .last_observation
                    .as_ref()
                    .is_some_and(|last| sequence <= last.sequence)
                {
                    return Ok(Some(IgnoreReason::StaleObservation));
                }
                validate_media_time(position)?;
                if let Some(duration) = duration {
                    validate_media_time(duration)?;
                }
                let entry = self
                    .current
                    .as_mut()
                    .expect("observation guard checked current");
                entry.position = position;
                if let Some(duration) = duration {
                    entry.duration = duration;
                }
                self.last_observation = Some(PlaybackObservation {
                    generation,
                    entry_id,
                    sequence,
                    position,
                    observed_state,
                    recorded_at_ms: now_ms,
                });
            }
            Command::SetLoop { enabled } => self.settings.loop_enabled = enabled,
            Command::SetVoteOnEnd { enabled } => self.settings.vote_on_end = enabled,
            Command::SetAudio { volume, muted } => {
                if volume > 100 {
                    return Err(CoreError::InvalidSettings("volume must be 0–100".into()));
                }
                self.audio = Audio {
                    volume,
                    muted: muted || volume == 0,
                };
            }
            Command::StartVote { vote_id } => self.start_vote(vote_id, false)?,
            Command::CancelVote => {
                let vote = self.vote.take().ok_or(CoreError::NoActiveVote)?;
                if let Some(entry) = &mut self.current {
                    entry.paused = vote.manual && vote.was_paused;
                    if !vote.manual {
                        entry.position = 0.0;
                    }
                }
                self.bump_generation()?;
            }
            Command::VoteChoice { index, viewer } => {
                let id = self.vote_choice_id(index)?;
                if !self.is_playable(&id) {
                    return Err(CoreError::InvalidVoteChoice);
                }
                validate_viewer(&viewer)?;
                let vote = self.vote.as_mut().ok_or(CoreError::NoActiveVote)?;
                if !vote.ballots.contains_key(&viewer) && vote.ballots.len() >= MAX_BALLOTS {
                    return Err(CoreError::VoteCapacity);
                }
                vote.ballots.insert(viewer, (index - 1) as u8);
            }
            Command::Choose { index } => {
                let id = self.vote_choice_id(index)?;
                if !self.is_playable(&id) {
                    return Err(CoreError::InvalidVoteChoice);
                }
                self.rotate_current(CompletionReason::Completed, now_ms)?;
                self.activate_by_id(&id)?;
            }
            Command::ConcludeVote => self.conclude_vote(now_ms)?,
            Command::ElapseVote {
                vote_id,
                seconds,
                sequence,
            } => {
                let Some(vote) = &mut self.vote else {
                    return Ok(Some(IgnoreReason::StaleVote));
                };
                if vote.id != vote_id || sequence <= vote.last_tick_sequence {
                    return Ok(Some(IgnoreReason::StaleVote));
                }
                vote.last_tick_sequence = sequence;
                vote.remaining = (vote.remaining - f64::from(seconds)).max(0.0);
                if vote.remaining == 0.0 {
                    self.conclude_vote(now_ms)?;
                }
            }
            Command::SkipVote { viewer } => {
                if !self.settings.skip_voting {
                    return Err(CoreError::SkipVotingDisabled);
                }
                self.require_playing()?;
                validate_viewer(&viewer)?;
                if !self.skip_ballots.contains_key(&viewer)
                    && self.skip_ballots.len() >= MAX_BALLOTS
                {
                    return Err(CoreError::VoteCapacity);
                }
                self.skip_ballots.insert(viewer, true);
                if self.skip_ballots.len() >= self.settings.skip_threshold {
                    self.skip(now_ms)?;
                }
            }
        }
        Ok(None)
    }

    fn all_queued(&self) -> impl Iterator<Item = &Entry> {
        self.priority_queue
            .iter()
            .chain(self.queue.iter())
            .chain(self.recycled_queue.iter())
            .chain(self.next_rotation_queue.iter())
    }

    fn lane_mut(&mut self, destination: Destination) -> &mut Vec<Entry> {
        match destination {
            Destination::Current => &mut self.queue,
            Destination::PlayNext => &mut self.priority_queue,
            Destination::Recycled => &mut self.recycled_queue,
            Destination::NextRotation => &mut self.next_rotation_queue,
        }
    }

    fn find_entry(&self, id: &str) -> Option<(Destination, usize)> {
        for lane in [
            Destination::PlayNext,
            Destination::Current,
            Destination::NextRotation,
            Destination::Recycled,
        ] {
            if let Some(index) = self.lane(lane).iter().position(|entry| entry.id == id) {
                return Some((lane, index));
            }
        }
        None
    }

    fn is_playable(&self, id: &str) -> bool {
        self.playable().any(|entry| entry.id == id)
    }

    fn prepare_new(&self, mut entry: Entry, now_ms: u64) -> Result<Entry, CoreError> {
        entry.validate()?;
        entry.position = 0.0;
        entry.paused = false;
        entry.play_count = 0;
        entry.last_played_at = None;
        entry.last_played_rotation = None;
        entry.added_at = Some(timestamp(now_ms));
        Ok(entry)
    }

    fn ensure_new_entries(&self, entries: &[Entry]) -> Result<(), CoreError> {
        if entries.len() > self.available_capacity() {
            return Err(CoreError::CapacityExceeded {
                requested: entries.len(),
                available: self.available_capacity(),
            });
        }
        let mut seen: BTreeSet<_> = self
            .current
            .iter()
            .chain(self.all_queued())
            .map(|entry| entry.id.as_str())
            .chain(self.history.iter().map(|item| item.entry.id.as_str()))
            .collect();
        for entry in entries {
            if !seen.insert(entry.id.as_str()) {
                return Err(CoreError::DuplicateEntryId(entry.id.clone()));
            }
        }
        Ok(())
    }

    fn add_many(
        &mut self,
        entries: Vec<Entry>,
        destination: Destination,
        now_ms: u64,
    ) -> Result<(), CoreError> {
        if destination == Destination::Recycled {
            return Err(CoreError::InvalidDestination);
        }
        let prepared = entries
            .into_iter()
            .map(|entry| self.prepare_new(entry, now_ms))
            .collect::<Result<Vec<_>, _>>()?;
        self.append_prepared(prepared, destination)
    }

    fn append_prepared(
        &mut self,
        entries: Vec<Entry>,
        destination: Destination,
    ) -> Result<(), CoreError> {
        if entries.is_empty() {
            return Ok(());
        }
        self.ensure_new_entries(&entries)?;
        self.lane_mut(destination).extend(entries);
        if self.current.is_none() {
            self.activate_first()?;
        }
        Ok(())
    }

    fn move_entries(
        &mut self,
        ids: Vec<String>,
        destination: Destination,
    ) -> Result<(), CoreError> {
        if ids.is_empty()
            || ids.len() > 500
            || ids.iter().collect::<BTreeSet<_>>().len() != ids.len()
        {
            return Err(CoreError::InvalidSelection(
                "select 1–500 unique queue entries".into(),
            ));
        }
        for id in &ids {
            if self.find_entry(id).is_none() {
                return Err(CoreError::EntryNotFound(id.clone()));
            }
        }
        let mut moved = false;
        for id in ids {
            let (lane, index) = self
                .find_entry(&id)
                .expect("all IDs were checked before moving");
            if lane == destination {
                continue;
            }
            let entry = self.lane_mut(lane).remove(index);
            self.lane_mut(destination).push(entry);
            if !matches!(destination, Destination::Current | Destination::PlayNext) {
                self.invalidate_vote_entry(&id);
            }
            moved = true;
        }
        if moved && self.current.is_none() {
            self.activate_first()?;
        }
        Ok(())
    }

    fn promote_next_rotation(&mut self) -> Result<bool, CoreError> {
        if self.playable().next().is_some()
            || !self.settings.loop_enabled
            || (self.recycled_queue.is_empty() && self.next_rotation_queue.is_empty())
        {
            return Ok(false);
        }
        self.rotation_number = self
            .rotation_number
            .checked_add(1)
            .ok_or(CoreError::CounterOverflow)?;
        // v1.2.3 places deferred new entries before previously played entries.
        self.queue.append(&mut self.next_rotation_queue);
        self.queue.append(&mut self.recycled_queue);
        Ok(true)
    }

    fn rotate_current(&mut self, reason: CompletionReason, now_ms: u64) -> Result<(), CoreError> {
        let Some(mut entry) = self.current.take() else {
            return Ok(());
        };
        let unavailable = reason == CompletionReason::Unavailable;
        let played_at = timestamp(now_ms);
        // Legacy Previous spreads the old history record into current. Those
        // old history keys must be replaced, never serialized twice through
        // flattened metadata in the new history record.
        for key in ["reason", "playedAt", "rotationNumber", "unavailable"] {
            entry.extra.remove(key);
        }
        if !unavailable {
            entry.play_count = entry
                .play_count
                .checked_add(1)
                .ok_or(CoreError::CounterOverflow)?;
            entry.last_played_at = Some(played_at.clone());
            entry.last_played_rotation = Some(self.rotation_number);
        }
        self.history.push(HistoryEntry {
            entry: entry.clone(),
            reason,
            played_at,
            rotation_number: self.rotation_number,
            unavailable,
        });
        if self.history.len() > MAX_HISTORY {
            self.history.drain(..self.history.len() - MAX_HISTORY);
        }
        if self.settings.loop_enabled && !unavailable {
            entry.position = 0.0;
            entry.paused = false;
            self.recycled_queue.push(entry);
        }
        self.last_observation = None;
        Ok(())
    }

    fn park_current(&mut self) {
        if let Some(entry) = self.current.take() {
            self.priority_queue.insert(0, entry);
        }
    }

    fn activate_first(&mut self) -> Result<(), CoreError> {
        if self.playable().next().is_none() {
            self.promote_next_rotation()?;
        }
        let next_id = self.playable().next().map(|entry| entry.id.clone());
        if let Some(id) = next_id {
            self.activate_by_id(&id)
        } else {
            self.current = None;
            self.vote = None;
            self.skip_ballots.clear();
            self.bump_generation()
        }
    }

    fn activate_by_id(&mut self, id: &str) -> Result<(), CoreError> {
        let (lane, index) = self
            .find_entry(id)
            .ok_or_else(|| CoreError::EntryNotFound(id.into()))?;
        if !matches!(lane, Destination::Current | Destination::PlayNext) {
            return Err(CoreError::InvalidSelection(
                "entry is not in a playable lane".into(),
            ));
        }
        let mut entry = self.lane_mut(lane).remove(index);
        entry.paused = false;
        self.current = Some(entry);
        self.vote = None;
        self.skip_ballots.clear();
        self.bump_generation()
    }

    fn bump_generation(&mut self) -> Result<(), CoreError> {
        self.generation = self
            .generation
            .checked_add(1)
            .ok_or(CoreError::CounterOverflow)?;
        self.last_observation = None;
        Ok(())
    }

    fn skip(&mut self, now_ms: u64) -> Result<(), CoreError> {
        self.rotate_current(CompletionReason::Skipped, now_ms)?;
        self.activate_first()
    }

    fn require_playing(&self) -> Result<(), CoreError> {
        if self.current.is_none() {
            return Err(CoreError::NoCurrentVideo);
        }
        if self.vote.is_some() {
            return Err(CoreError::VoteActive);
        }
        Ok(())
    }

    fn observation_guard(&self, generation: u64, entry_id: &str) -> Option<IgnoreReason> {
        let Some(entry) = &self.current else {
            return Some(IgnoreReason::NoCurrentVideo);
        };
        if self.vote.is_some() {
            return Some(IgnoreReason::VoteActive);
        }
        if generation != self.generation {
            return Some(IgnoreReason::StaleGeneration);
        }
        if entry.id != entry_id {
            return Some(IgnoreReason::DifferentEntry);
        }
        None
    }

    fn start_vote(&mut self, vote_id: String, automatic: bool) -> Result<(), CoreError> {
        self.require_playing()?;
        if !valid_identity(&vote_id, 128) {
            return Err(CoreError::InvalidState("invalid vote ID".into()));
        }
        self.promote_next_rotation()?;
        let choices: Vec<_> = self
            .playable()
            .take(4)
            .map(|entry| Some(entry.id.clone()))
            .collect();
        if choices.is_empty() {
            return Err(CoreError::NoVoteChoices);
        }
        let current = self.current.as_mut().expect("current was checked");
        let was_paused = current.paused;
        current.paused = true;
        self.vote = Some(VoteRound {
            id: vote_id,
            choices,
            remaining: f64::from(self.settings.vote_seconds),
            ballots: BTreeMap::new(),
            manual: !automatic,
            was_paused,
            last_tick_sequence: 0,
            extra: Map::new(),
        });
        Ok(())
    }

    fn invalidate_vote_entry(&mut self, id: &str) {
        if let Some(vote) = &mut self.vote {
            for (index, choice) in vote.choices.iter_mut().enumerate() {
                if choice.as_deref() == Some(id) {
                    *choice = None;
                    vote.ballots
                        .retain(|_, ballot| usize::from(*ballot) != index);
                }
            }
        }
    }

    fn vote_choice_id(&self, index: usize) -> Result<String, CoreError> {
        let vote = self.vote.as_ref().ok_or(CoreError::NoActiveVote)?;
        if !(1..=4).contains(&index) {
            return Err(CoreError::InvalidVoteChoice);
        }
        vote.choices
            .get(index - 1)
            .cloned()
            .flatten()
            .ok_or(CoreError::InvalidVoteChoice)
    }

    fn conclude_vote(&mut self, now_ms: u64) -> Result<(), CoreError> {
        let Some(vote) = &self.vote else {
            return Ok(());
        };
        let counts = self.vote_counts();
        let mut winner: Option<(usize, String)> = None;
        for (index, choice) in vote.choices.iter().enumerate() {
            if let Some(id) = choice {
                if self.is_playable(id)
                    && winner
                        .as_ref()
                        .is_none_or(|(count, _)| counts[index] > *count)
                {
                    winner = Some((counts[index], id.clone()));
                }
            }
        }
        self.rotate_current(CompletionReason::Completed, now_ms)?;
        if let Some((_, id)) = winner {
            self.activate_by_id(&id)
        } else {
            self.activate_first()
        }
    }
}

fn validate_viewer(viewer: &str) -> Result<(), CoreError> {
    if valid_identity(viewer, 256) {
        Ok(())
    } else {
        Err(CoreError::InvalidViewer)
    }
}

/// UTC formatting without a clock or platform dependency. The civil-date
/// conversion uses Gregorian 400-year eras; input is milliseconds since epoch.
pub(crate) fn timestamp(now_ms: u64) -> String {
    let seconds = now_ms / 1_000;
    let z = (seconds / 86_400) as i64 + 719_468;
    let era = z / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = month_index + if month_index < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    let time = seconds % 86_400;
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        time / 3_600,
        time / 60 % 60,
        time % 60,
        now_ms % 1_000
    )
}

#[cfg(test)]
mod timestamp_tests {
    use super::timestamp;

    #[test]
    fn utc_format_handles_epoch_and_gregorian_leap_days() {
        assert_eq!(timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(timestamp(951_827_696_789), "2000-02-29T12:34:56.789Z");
        assert_eq!(timestamp(4_107_542_400_000), "2100-03-01T00:00:00.000Z");
    }
}
