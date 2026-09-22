//! Registry of resumable harness streams (Phase 2 of intelligent
//! reconnect).
//!
//! Long-running harness flows surfaced over SSE — spec generation, chat
//! turns, image/video/3D generation — historically tied the
//! [`HarnessSession`] lifetime to the HTTP response: the session lived
//! inside the SSE `stream::unfold`, so the moment the client's
//! connection dropped, `commands_tx` dropped, the harness WS bridge
//! closed, and the harness tore the run down. A reconnecting client had
//! nothing to attach back to.
//!
//! [`LiveStreamRegistry`] decouples the two. When a flow starts, the
//! handler registers its [`HarnessSession`] here. A background forwarder
//! task pumps every harness frame into a bounded, sequenced
//! [`EventLog`], holding the session alive until the run reaches a
//! terminal event. The SSE response merely *attaches* to the registered
//! stream and can be re-established (with a `?since=<seq>` cursor) any
//! number of times without disturbing the underlying run. Completed
//! streams linger for a TTL so a client that reconnects just after the
//! final frame still receives the tail of the output.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use serde::Serialize;
use tokio::sync::{broadcast, oneshot, Mutex as AsyncMutex};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use aura_os_harness::{
    ErrorMsg, HarnessCommandSender, HarnessInbound, HarnessOutbound, HarnessSession,
    MessageAttachment, SessionBridge, SessionBridgeTurn,
};
use aura_protocol::{ToolApprovalDecision, ToolApprovalRemember, ToolApprovalResponse};

use crate::event_log::EventLog;

/// Opaque handle a client uses to (re)attach to a stream.
pub type AttachId = String;

/// Default per-stream replay ring size (number of harness frames).
pub const DEFAULT_STREAM_LOG_CAPACITY: usize = 4096;
/// Env var overriding [`DEFAULT_STREAM_LOG_CAPACITY`].
pub const STREAM_LOG_CAPACITY_ENV: &str = "AURA_STREAM_LOG_CAPACITY";

/// Default retention for a terminated stream before the sweeper drops
/// it, in seconds.
pub const DEFAULT_STREAM_TTL_SECS: u64 = 300;
/// Env var overriding [`DEFAULT_STREAM_TTL_SECS`].
pub const STREAM_TTL_SECS_ENV: &str = "AURA_STREAM_TTL_SECS";
const CHAT_COMMAND_RECEIPT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const USER_INPUT_RECEIPT_TTL: Duration = Duration::from_secs(24 * 60 * 60);
const USER_INPUT_PENDING_TTL: Duration = Duration::from_secs(31 * 60);

/// One selectable answer advertised by Aura's `request_user_input` tool.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct UserInputQuestionOption {
    pub label: String,
    pub description: String,
}

/// A typed question that can be answered by any authenticated Aura client.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
pub struct UserInputQuestion {
    pub id: String,
    pub header: String,
    pub question: String,
    pub options: Vec<UserInputQuestionOption>,
    #[serde(default)]
    pub multi_select: bool,
}

/// Wire answer shape. Single-select/free-text questions use a string;
/// multi-select questions use a non-empty string array.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum UserInputAnswer {
    Single(String),
    Multiple(Vec<String>),
}

pub type UserInputAnswers = HashMap<String, UserInputAnswer>;

/// Safe cold-start projection of an unresolved question. The owner id stays
/// private in the registry and is used only for authorization filtering.
#[derive(Clone, Debug, Serialize)]
pub struct PendingUserInputSummary {
    pub request_id: String,
    pub questions: Vec<UserInputQuestion>,
    pub agent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_instance_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub started_at_ms: i64,
}

struct PendingUserInputResolution {
    sender: Option<oneshot::Sender<UserInputAnswers>>,
    answers: Option<UserInputAnswers>,
}

struct PendingUserInput {
    owner_id: String,
    summary: PendingUserInputSummary,
    resolution: Mutex<PendingUserInputResolution>,
    created_at: Instant,
}

struct UserInputReceipt {
    owner_id: String,
    answers: UserInputAnswers,
    recorded_at: Instant,
}

pub struct UserInputRegistration {
    pub summary: PendingUserInputSummary,
    pub receiver: oneshot::Receiver<UserInputAnswers>,
}

/// Kind of harness flow a stream represents. Lets the client route a
/// reattached stream back into the right UI surface.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    SpecGen,
    SpecSummary,
    ChatTurn,
    ImageGen,
    VideoGen,
    Mesh3dGen,
    /// A child subagent run spawned by a parent chat turn's `task`
    /// tool. Registered when a client attaches to the child run's
    /// live stream via the subagent-attach endpoint so the existing
    /// `GET /api/streams/:attach_id` replay/tail surface serves the
    /// child thread without a bespoke SSE body.
    SubagentTurn,
}

/// Ownership / addressing metadata used for authz filtering and to let
/// the client match a reattached stream to a mounted view.
#[derive(Clone, Debug, Default, Serialize)]
pub struct StreamScope {
    pub user_id: Option<String>,
    pub project_id: Option<String>,
    /// Stable template-agent identity shared by desktop and mobile.
    /// This is intentionally separate from `agent_instance_id`, which
    /// addresses the project-local runtime instance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub agent_instance_id: Option<String>,
    pub session_id: Option<String>,
    /// Originating parent `task` tool-use id for a
    /// [`StreamKind::SubagentTurn`] stream. Lets the client match a
    /// reattached subagent thread back to the tool card that spawned
    /// it. `None` for all non-subagent streams.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_tool_use_id: Option<String>,
    /// Child harness run id for a [`StreamKind::SubagentTurn`] stream.
    /// Lets the prompt-into-subagent endpoint find the registered live
    /// stream (and its retained [`HarnessSession`]) without the client
    /// having to round-trip the opaque `attach_id`. `None` for all
    /// non-subagent streams.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub child_run_id: Option<String>,
}

/// A single registered, resumable harness stream.
pub struct LiveStream {
    pub attach_id: AttachId,
    pub kind: StreamKind,
    pub scope: StreamScope,
    /// Sequenced replay ring of serialized harness frames. Survives the
    /// underlying [`HarnessSession`] being dropped on completion.
    pub events: Arc<EventLog>,
    /// Held only to keep `commands_tx` (and therefore the upstream
    /// harness WS) alive while the run is in flight. Cleared by the
    /// forwarder once the stream terminates so the harness can release
    /// the session. `None` for streams registered via
    /// [`LiveStreamRegistry::register_receiver`], where the session is
    /// owned elsewhere (e.g. chat turns whose session lives in
    /// `chat_sessions`).
    session: Mutex<Option<HarnessSession>>,
    /// Optional inbound command channel for streams that do NOT own the
    /// harness session. When present, [`LiveStream::cancel`] forwards
    /// `HarnessInbound::Cancel` so the upstream harness aborts the
    /// in-flight turn in addition to firing the cancellation token.
    /// `None` for the owned-session [`LiveStreamRegistry::register`]
    /// path, where dropping the session is sufficient to tear the run
    /// down. Cleared on termination so retained replay data does not keep
    /// the transport alive or allow cancellation of a later reused turn.
    cancel_tx: Mutex<Option<HarnessCommandSender>>,
    /// In-memory receipts make retries of an uncertain mobile response
    /// idempotent for the lifetime of the environment-owned run.
    responded_approvals: Mutex<HashMap<String, (ToolApprovalDecision, ToolApprovalRemember)>>,
    started_at_ms: i64,
    terminated_at: Mutex<Option<Instant>>,
    cancel: CancellationToken,
}

impl LiveStream {
    /// True once a terminal frame (or cancellation / upstream close) has
    /// been observed.
    pub fn is_terminated(&self) -> bool {
        self.terminated_at
            .lock()
            .expect("live stream terminated_at poisoned")
            .is_some()
    }

    fn mark_terminated(&self) {
        let mut guard = self
            .terminated_at
            .lock()
            .expect("live stream terminated_at poisoned");
        if guard.is_none() {
            *guard = Some(Instant::now());
        }
        // Dropping the session closes the upstream harness WS now that
        // we have all the frames buffered for replay.
        *self.session.lock().expect("live stream session poisoned") = None;
        // Replay retention must not retain a live transport, or let an old
        // stream cancel a later turn on the reused chat session.
        self.cancel_tx
            .lock()
            .expect("live stream cancel_tx poisoned")
            .take();
    }

    /// Request cancellation of the underlying run. The forwarder emits a
    /// synthetic `stream_cancelled` terminal frame and tears down. For
    /// streams that do not own the harness session (registered via
    /// [`LiveStreamRegistry::register_receiver`]), this additionally
    /// forwards `HarnessInbound::Cancel` over the stored command channel
    /// so the upstream harness aborts its in-flight turn — dropping the
    /// (unowned) session is not enough in that case.
    pub fn cancel(&self) {
        let guard = self
            .cancel_tx
            .lock()
            .expect("live stream cancel_tx poisoned");
        if let Some(tx) = guard.as_ref() {
            if let Err(err) = tx.try_send(HarnessInbound::Cancel) {
                debug!(
                    target: "aura::streams",
                    attach_id = %self.attach_id,
                    error = %err,
                    "live stream cancel: failed to forward Cancel to harness"
                );
            }
        }
        drop(guard);
        // Forward the command before waking the task that clears cancel_tx.
        self.cancel.cancel();
    }

    /// Forward a user's decision for a live tool-approval prompt to the
    /// environment-owned harness turn. Chat streams are registered through
    /// `register_receiver`, so their command sender lives in `cancel_tx`
    /// even though it carries more than cancellation commands.
    pub fn respond_to_tool_approval(
        &self,
        request_id: String,
        decision: ToolApprovalDecision,
        remember: ToolApprovalRemember,
    ) -> Result<(), String> {
        if self.is_terminated() {
            return Err("run is no longer active".to_string());
        }
        let response_key = (decision, remember);
        let remember_value = match remember {
            ToolApprovalRemember::Once => "once",
            ToolApprovalRemember::Session => "session",
            ToolApprovalRemember::Forever => "forever",
        };
        let prompt_accepts_response = self.events.any_value(|value| {
            if value.get("type").and_then(|v| v.as_str()) != Some("tool_approval_prompt")
                || value.get("request_id").and_then(|v| v.as_str()) != Some(&request_id)
            {
                return false;
            }
            let Some(options) = value.get("remember_options").and_then(|v| v.as_array()) else {
                return remember == ToolApprovalRemember::Once;
            };
            (options.is_empty() && remember == ToolApprovalRemember::Once)
                || options
                    .iter()
                    .any(|option| option.as_str() == Some(remember_value))
        });
        if !prompt_accepts_response {
            return Err("approval response uses an unavailable remember scope".to_string());
        }
        {
            let mut responded = self
                .responded_approvals
                .lock()
                .expect("live stream approval receipts poisoned");
            if let Some(existing) = responded.get(&request_id) {
                return if *existing == response_key {
                    Ok(())
                } else {
                    Err("approval request was already answered differently".to_string())
                };
            }
            responded.insert(request_id.clone(), response_key);
        }
        let guard = self
            .cancel_tx
            .lock()
            .expect("live stream cancel_tx poisoned");
        let tx = guard
            .as_ref()
            .ok_or_else(|| "run does not accept approval responses".to_string())?;
        let result = tx.try_send(HarnessInbound::ToolApprovalResponse(ToolApprovalResponse {
            request_id: request_id.clone(),
            decision,
            remember,
        }));
        if let Err(err) = result {
            self.responded_approvals
                .lock()
                .expect("live stream approval receipts poisoned")
                .remove(&request_id);
            return Err(err.to_string());
        }
        self.events.append(serde_json::json!({
            "type": "tool_approval_resolved",
            "request_id": request_id,
        }));
        Ok(())
    }

    fn pending_tool_approvals(&self) -> Vec<PendingToolApprovalSummary> {
        let mut pending = HashMap::<String, PendingToolApprovalSummary>::new();
        for value in self.events.snapshot_values() {
            match value.get("type").and_then(|entry| entry.as_str()) {
                Some("tool_approval_prompt") => {
                    let Some(request_id) = value
                        .get("request_id")
                        .and_then(|entry| entry.as_str())
                        .filter(|entry| !entry.is_empty())
                    else {
                        continue;
                    };
                    let Some(tool_name) = value
                        .get("tool_name")
                        .and_then(|entry| entry.as_str())
                        .filter(|entry| !entry.is_empty())
                    else {
                        continue;
                    };
                    let agent_id = self.scope.agent_id.as_deref().or_else(|| {
                        value
                            .get("agent_id")
                            .and_then(|entry| entry.as_str())
                            .filter(|entry| !entry.is_empty())
                    });
                    let Some(agent_id) = agent_id else {
                        continue;
                    };
                    pending.insert(
                        request_id.to_string(),
                        PendingToolApprovalSummary {
                            request_id: request_id.to_string(),
                            tool_name: tool_name.to_string(),
                            agent_id: agent_id.to_string(),
                            project_id: self.scope.project_id.clone(),
                            agent_instance_id: self.scope.agent_instance_id.clone(),
                            session_id: self.scope.session_id.clone(),
                            started_at_ms: self.started_at_ms,
                        },
                    );
                }
                Some("tool_approval_resolved") => {
                    if let Some(request_id) =
                        value.get("request_id").and_then(|entry| entry.as_str())
                    {
                        pending.remove(request_id);
                    }
                }
                _ => {}
            }
        }
        pending.into_values().collect()
    }

    /// Send a follow-up user message into the underlying run. Only
    /// possible while this stream still owns a live [`HarnessSession`]
    /// (i.e. it was registered via [`LiveStreamRegistry::register`] and
    /// has not yet terminated). Used to prompt a still-running subagent
    /// thread so it is no longer a read-only surface. Returns an error
    /// string when the run has already terminated (session reaped) or
    /// the inbound command channel is full / closed.
    pub fn send_user_message(
        &self,
        content: String,
        attachments: Option<Vec<MessageAttachment>>,
    ) -> Result<(), String> {
        let guard = self.session.lock().expect("live stream session poisoned");
        let session = guard
            .as_ref()
            .ok_or_else(|| "run is no longer active".to_string())?;
        SessionBridge::send_user_message(
            &session.commands_tx,
            SessionBridgeTurn {
                content,
                tool_hints: None,
                attachments,
            },
        )
        .map_err(|err| err.to_string())
    }

    /// Build the listing summary for `GET /api/streams/active`.
    pub fn summary(&self) -> ActiveStreamSummary {
        ActiveStreamSummary {
            attach_id: self.attach_id.clone(),
            kind: self.kind,
            scope: self.scope.clone(),
            latest_seq: self.events.latest_seq(),
            terminated: self.is_terminated(),
            started_at_ms: self.started_at_ms,
            activity: self.current_activity(),
        }
    }

    /// Return a content-free description of the newest useful harness frame.
    /// This powers mobile activity surfaces without exposing prompts, model
    /// output, command text, file paths, or tool arguments in a shell-level
    /// snapshot.
    fn current_activity(&self) -> Option<String> {
        if self.is_terminated() {
            return None;
        }
        self.events
            .snapshot_values()
            .iter()
            .rev()
            .find_map(|value| redacted_stream_activity(value))
    }
}

fn redacted_stream_activity(value: &serde_json::Value) -> Option<String> {
    let event_type = value.get("type").and_then(|entry| entry.as_str())?;
    let label = match event_type {
        "tool_approval_prompt" => "Waiting for approval",
        "agent_user_input_requested" => "Waiting for your answer",
        "thinking_delta" => "Thinking",
        "text_delta" => "Responding",
        "assistant_message_start" => "Starting response",
        "tool_result" => "Reviewing tool results",
        "subagent_spawned" | "subagent_status" => "Coordinating agents",
        "tool_use_start" | "tool_call_snapshot" => {
            return Some(tool_activity_label(
                value.get("name").and_then(|entry| entry.as_str()),
            ));
        }
        "progress" => {
            let stage = value.get("stage").and_then(|entry| entry.as_str());
            if stage == Some("tool_running") {
                return Some(tool_activity_label(
                    value.get("tool_name").and_then(|entry| entry.as_str()),
                ));
            }
            if matches!(stage, Some("forked_for_context" | "auto_fork")) {
                "Managing context"
            } else {
                return None;
            }
        }
        _ => return None,
    };
    Some(label.to_string())
}

fn tool_activity_label(name: Option<&str>) -> String {
    let label = match name.unwrap_or_default().to_ascii_lowercase().as_str() {
        "read_file" | "list_files" | "find_files" | "search_code" | "stat_file" => {
            "Inspecting code"
        }
        "write_file" | "edit_file" | "apply_patch" => "Editing code",
        "run_command" | "run_terminal" | "shell" | "terminal" => "Running a command",
        "task" | "send_to_agent" | "list_agents" | "council" => "Coordinating agents",
        "web_search" | "web_fetch" | "browser" => "Researching",
        _ => "Using a tool",
    };
    label.to_string()
}

/// JSON row in the `GET /api/streams/active` response.
#[derive(Clone, Debug, Serialize)]
pub struct ActiveStreamSummary {
    pub attach_id: AttachId,
    pub kind: StreamKind,
    pub scope: StreamScope,
    pub latest_seq: u64,
    pub terminated: bool,
    pub started_at_ms: i64,
    /// Content-free current activity suitable for mobile shell surfaces.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity: Option<String>,
}

/// User-facing identity for an unresolved protected-tool request.
#[derive(Clone, Debug, Serialize)]
pub struct PendingToolApprovalSummary {
    pub request_id: String,
    pub tool_name: String,
    pub agent_id: String,
    pub project_id: Option<String>,
    pub agent_instance_id: Option<String>,
    pub session_id: Option<String>,
    pub started_at_ms: i64,
}

#[derive(Clone)]
pub struct ChatCommandMatch {
    pub session_id: String,
    pub project_id: String,
    pub content: String,
    pub stream: Option<Arc<LiveStream>>,
}

#[derive(Clone, Debug)]
struct ChatCommandReceipt {
    session_id: String,
    project_id: String,
    content: String,
    attach_id: Option<AttachId>,
    recorded_at: Instant,
}

/// Registry of all live/recently-terminated harness streams.
pub struct LiveStreamRegistry {
    inner: DashMap<AttachId, Arc<LiveStream>>,
    chat_command_receipts: DashMap<String, ChatCommandReceipt>,
    chat_command_locks: DashMap<String, Weak<AsyncMutex<()>>>,
    pending_user_inputs: DashMap<String, Arc<PendingUserInput>>,
    user_input_receipts: DashMap<String, UserInputReceipt>,
    stream_capacity: usize,
    ttl: Duration,
}

impl LiveStreamRegistry {
    /// Build a registry, reading capacity/TTL from the environment.
    pub fn from_env() -> Arc<Self> {
        let stream_capacity = std::env::var(STREAM_LOG_CAPACITY_ENV)
            .ok()
            .and_then(|v| v.parse::<usize>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(DEFAULT_STREAM_LOG_CAPACITY);
        let ttl_secs = std::env::var(STREAM_TTL_SECS_ENV)
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(DEFAULT_STREAM_TTL_SECS);
        let registry = Arc::new(Self {
            inner: DashMap::new(),
            chat_command_receipts: DashMap::new(),
            chat_command_locks: DashMap::new(),
            pending_user_inputs: DashMap::new(),
            user_input_receipts: DashMap::new(),
            stream_capacity,
            ttl: Duration::from_secs(ttl_secs),
        });
        registry.clone().spawn_sweeper();
        registry
    }

    /// Register a freshly-opened harness session and start pumping its
    /// frames into a replay log. Returns the live stream handle whose
    /// `attach_id` the client uses to attach.
    pub fn register(
        self: &Arc<Self>,
        kind: StreamKind,
        scope: StreamScope,
        mut session: HarnessSession,
    ) -> Arc<LiveStream> {
        let attach_id = uuid::Uuid::new_v4().to_string();
        let events = EventLog::new(self.stream_capacity);
        // Adopt the receiver primed at WS-bridge creation when present, so
        // the harness's replay-on-attach burst (a completed child run's
        // ENTIRE transcript) is captured. A late `events_tx.subscribe()`
        // here would race the bridge reader and drop that burst, leaving
        // the EventLog (and thus the UI) empty for an already-finished
        // run — the AURA Council member symptom.
        let rx = session
            .events_rx
            .take()
            .unwrap_or_else(|| session.events_tx.subscribe());
        let cancel = CancellationToken::new();
        let stream = Arc::new(LiveStream {
            attach_id: attach_id.clone(),
            kind,
            scope,
            events,
            session: Mutex::new(Some(session)),
            cancel_tx: Mutex::new(None),
            responded_approvals: Mutex::new(HashMap::new()),
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            terminated_at: Mutex::new(None),
            cancel: cancel.clone(),
        });
        self.inner.insert(attach_id.clone(), stream.clone());

        spawn_forwarder(stream.clone(), rx, cancel);

        stream
    }

    /// Register a stream that pumps an already-subscribed broadcast
    /// receiver into a replay log WITHOUT owning the underlying
    /// [`HarnessSession`]. Used for chat turns where the harness session
    /// is reused across turns and lives in `chat_sessions`, not here —
    /// so the live stream must observe the turn's frames without holding
    /// (and therefore dropping/closing) the shared session.
    ///
    /// `cancel_tx` is the harness inbound command channel; when present,
    /// [`LiveStream::cancel`] forwards `HarnessInbound::Cancel` over it
    /// so an explicit cancel actually aborts the upstream turn (dropping
    /// an unowned session would not). Terminal detection and TTL
    /// retention match [`LiveStreamRegistry::register`] exactly via the
    /// shared [`spawn_forwarder`].
    pub fn register_receiver(
        self: &Arc<Self>,
        kind: StreamKind,
        scope: StreamScope,
        rx: broadcast::Receiver<HarnessOutbound>,
        cancel_tx: Option<HarnessCommandSender>,
    ) -> Arc<LiveStream> {
        let attach_id = uuid::Uuid::new_v4().to_string();
        let events = EventLog::new(self.stream_capacity);
        let cancel = CancellationToken::new();
        let stream = Arc::new(LiveStream {
            attach_id: attach_id.clone(),
            kind,
            scope,
            events,
            session: Mutex::new(None),
            cancel_tx: Mutex::new(cancel_tx),
            responded_approvals: Mutex::new(HashMap::new()),
            started_at_ms: chrono::Utc::now().timestamp_millis(),
            terminated_at: Mutex::new(None),
            cancel: cancel.clone(),
        });
        self.inner.insert(attach_id.clone(), stream.clone());

        spawn_forwarder(stream.clone(), rx, cancel);

        stream
    }

    /// Look up a stream by attach id.
    pub fn get(&self, attach_id: &str) -> Option<Arc<LiveStream>> {
        self.inner.get(attach_id).map(|e| e.value().clone())
    }

    fn chat_command_key(user_id: Option<&str>, command_id: &str) -> String {
        let owner = user_id.unwrap_or("");
        format!("{}:{owner}:{command_id}", owner.len())
    }

    /// Serialize attempts carrying the same client command id. The map stores
    /// weak references so completed commands do not retain one mutex forever;
    /// the registry sweeper removes dead keys.
    pub fn chat_command_lock(
        &self,
        user_id: Option<&str>,
        command_id: &str,
    ) -> Arc<AsyncMutex<()>> {
        use dashmap::mapref::entry::Entry;

        let key = Self::chat_command_key(user_id, command_id);
        match self.chat_command_locks.entry(key) {
            Entry::Occupied(mut occupied) => {
                if let Some(lock) = occupied.get().upgrade() {
                    return lock;
                }
                let lock = Arc::new(AsyncMutex::new(()));
                occupied.insert(Arc::downgrade(&lock));
                lock
            }
            Entry::Vacant(vacant) => {
                let lock = Arc::new(AsyncMutex::new(()));
                vacant.insert(Arc::downgrade(&lock));
                lock
            }
        }
    }

    pub fn record_chat_command(
        &self,
        user_id: Option<&str>,
        command_id: &str,
        session_id: &str,
        project_id: &str,
        content: &str,
    ) {
        let key = Self::chat_command_key(user_id, command_id);
        self.chat_command_receipts.insert(
            key,
            ChatCommandReceipt {
                session_id: session_id.to_string(),
                project_id: project_id.to_string(),
                content: content.to_string(),
                attach_id: None,
                recorded_at: Instant::now(),
            },
        );
    }

    pub fn attach_chat_command(&self, user_id: Option<&str>, command_id: &str, attach_id: &str) {
        let key = Self::chat_command_key(user_id, command_id);
        if let Some(mut receipt) = self.chat_command_receipts.get_mut(&key) {
            receipt.attach_id = Some(attach_id.to_string());
        }
    }

    pub fn find_chat_command(
        &self,
        user_id: Option<&str>,
        command_id: &str,
    ) -> Option<ChatCommandMatch> {
        let key = Self::chat_command_key(user_id, command_id);
        let receipt = self.chat_command_receipts.get(&key)?;
        let session_id = receipt.session_id.clone();
        let project_id = receipt.project_id.clone();
        let content = receipt.content.clone();
        let attach_id = receipt.attach_id.clone();
        drop(receipt);
        let stream = attach_id.and_then(|id| self.get(&id));
        Some(ChatCommandMatch {
            session_id,
            project_id,
            content,
            stream,
        })
    }

    /// Register one environment-owned structured question and return the
    /// receiver the installed tool handler waits on. The prompt remains
    /// discoverable independently of the originating HTTP client.
    pub fn register_user_input(
        &self,
        owner_id: String,
        agent_id: String,
        project_id: Option<String>,
        agent_instance_id: Option<String>,
        session_id: Option<String>,
        questions: Vec<UserInputQuestion>,
    ) -> UserInputRegistration {
        let request_id = uuid::Uuid::new_v4().to_string();
        let summary = PendingUserInputSummary {
            request_id: request_id.clone(),
            questions,
            agent_id,
            project_id,
            agent_instance_id,
            session_id,
            started_at_ms: chrono::Utc::now().timestamp_millis(),
        };
        let (sender, receiver) = oneshot::channel();
        self.pending_user_inputs.insert(
            request_id,
            Arc::new(PendingUserInput {
                owner_id,
                summary: summary.clone(),
                resolution: Mutex::new(PendingUserInputResolution {
                    sender: Some(sender),
                    answers: None,
                }),
                created_at: Instant::now(),
            }),
        );
        UserInputRegistration { summary, receiver }
    }

    /// Resolve an outstanding question by opaque request id. Answers are
    /// validated against the original typed questions and duplicate retries
    /// are idempotent when they carry the same payload.
    pub fn respond_to_user_input(
        &self,
        owner_id: &str,
        request_id: &str,
        answers: UserInputAnswers,
    ) -> Result<(), String> {
        if let Some(receipt) = self.user_input_receipts.get(request_id) {
            if receipt.owner_id != owner_id {
                return Err("user input request is not owned by this account".to_string());
            }
            return if receipt.answers == answers {
                Ok(())
            } else {
                Err("user input request was already answered differently".to_string())
            };
        }

        let pending = self
            .pending_user_inputs
            .get(request_id)
            .map(|entry| entry.value().clone())
            .ok_or_else(|| "pending user input request not found".to_string())?;
        if pending.owner_id != owner_id {
            return Err("user input request is not owned by this account".to_string());
        }
        validate_user_input_answers(&pending.summary.questions, &answers)?;

        let mut resolution = pending
            .resolution
            .lock()
            .expect("pending user input resolution poisoned");
        if let Some(existing) = resolution.answers.as_ref() {
            return if existing == &answers {
                Ok(())
            } else {
                Err("user input request was already answered differently".to_string())
            };
        }
        let sender = resolution
            .sender
            .take()
            .ok_or_else(|| "agent is no longer waiting for this answer".to_string())?;
        sender
            .send(answers.clone())
            .map_err(|_| "agent is no longer waiting for this answer".to_string())?;
        resolution.answers = Some(answers);
        Ok(())
    }

    /// Move a delivered answer into the bounded idempotency receipt table.
    pub fn finish_user_input(&self, request_id: &str) {
        let Some((_, pending)) = self.pending_user_inputs.remove(request_id) else {
            return;
        };
        let answers = pending
            .resolution
            .lock()
            .expect("pending user input resolution poisoned")
            .answers
            .clone();
        if let Some(answers) = answers {
            self.user_input_receipts.insert(
                request_id.to_string(),
                UserInputReceipt {
                    owner_id: pending.owner_id.clone(),
                    answers,
                    recorded_at: Instant::now(),
                },
            );
        }
    }

    pub fn cancel_user_input(&self, request_id: &str) {
        self.pending_user_inputs.remove(request_id);
    }

    pub fn list_pending_user_inputs(&self, owner_id: &str) -> Vec<PendingUserInputSummary> {
        let mut prompts: Vec<_> = self
            .pending_user_inputs
            .iter()
            .filter_map(|entry| {
                let pending = entry.value();
                if pending.owner_id != owner_id {
                    return None;
                }
                let resolution = pending
                    .resolution
                    .lock()
                    .expect("pending user input resolution poisoned");
                (resolution.answers.is_none()
                    && resolution
                        .sender
                        .as_ref()
                        .map(|sender| !sender.is_closed())
                        .unwrap_or(false))
                .then(|| pending.summary.clone())
            })
            .collect();
        prompts.sort_by(|left, right| right.started_at_ms.cmp(&left.started_at_ms));
        prompts
    }

    /// Find the most recently-registered, still-live subagent stream for
    /// a child run id. Used by the prompt-into-subagent endpoint to send
    /// a follow-up turn into a running child thread. Prefers a
    /// non-terminated stream (one that still owns its harness session)
    /// so a stale terminated entry lingering in the TTL window does not
    /// shadow a fresh re-attach.
    pub fn get_subagent(&self, child_run_id: &str) -> Option<Arc<LiveStream>> {
        let mut fallback: Option<Arc<LiveStream>> = None;
        for entry in self.inner.iter() {
            let stream = entry.value();
            if stream.kind != StreamKind::SubagentTurn {
                continue;
            }
            if stream.scope.child_run_id.as_deref() != Some(child_run_id) {
                continue;
            }
            if !stream.is_terminated() {
                return Some(stream.clone());
            }
            fallback = Some(stream.clone());
        }
        fallback
    }

    /// All streams visible to `user_id`, optionally narrowed to a
    /// project / agent instance. A stream with no `user_id` scope is
    /// treated as visible to everyone (used by anonymous flows).
    pub fn list_for_scope(
        &self,
        user_id: &str,
        project_id: Option<&str>,
        agent_instance_id: Option<&str>,
    ) -> Vec<ActiveStreamSummary> {
        self.inner
            .iter()
            .filter(|entry| {
                let s = &entry.value().scope;
                let user_ok = s.user_id.as_deref().map(|u| u == user_id).unwrap_or(true);
                let project_ok = project_id
                    .map(|p| s.project_id.as_deref() == Some(p))
                    .unwrap_or(true);
                let instance_ok = agent_instance_id
                    .map(|a| s.agent_instance_id.as_deref() == Some(a))
                    .unwrap_or(true);
                user_ok && project_ok && instance_ok
            })
            .map(|entry| entry.value().summary())
            .collect()
    }

    /// Find the caller-owned, still-running chat stream that emitted a
    /// particular tool approval request. Request ids are generated by the
    /// harness and are unique within a run; matching against the retained
    /// event log lets a reattached mobile client answer the same prompt
    /// without knowing the opaque attach id used by the original client.
    pub fn find_chat_tool_approval(
        &self,
        user_id: &str,
        request_id: &str,
    ) -> Option<Arc<LiveStream>> {
        self.inner
            .iter()
            .filter_map(|entry| {
                let stream = entry.value();
                let owned = stream.scope.user_id.as_deref() == Some(user_id);
                if stream.kind != StreamKind::ChatTurn || stream.is_terminated() || !owned {
                    return None;
                }
                let matches = stream.events.any_value(|value| {
                    value.get("type").and_then(|v| v.as_str()) == Some("tool_approval_prompt")
                        && value.get("request_id").and_then(|v| v.as_str()) == Some(request_id)
                });
                matches.then(|| stream.clone())
            })
            .max_by_key(|stream| stream.started_at_ms)
    }

    /// Snapshot every unresolved protected-tool request owned by `user_id`.
    pub fn list_pending_tool_approvals(&self, user_id: &str) -> Vec<PendingToolApprovalSummary> {
        let mut approvals: Vec<_> = self
            .inner
            .iter()
            .filter_map(|entry| {
                let stream = entry.value();
                (stream.kind == StreamKind::ChatTurn
                    && !stream.is_terminated()
                    && stream.scope.user_id.as_deref() == Some(user_id))
                .then(|| stream.pending_tool_approvals())
            })
            .flatten()
            .collect();
        approvals.sort_by(|left, right| right.started_at_ms.cmp(&left.started_at_ms));
        approvals
    }

    fn spawn_sweeper(self: Arc<Self>) {
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(30));
            loop {
                interval.tick().await;
                let now = Instant::now();
                let ttl = self.ttl;
                self.inner.retain(|_, stream| {
                    match *stream
                        .terminated_at
                        .lock()
                        .expect("live stream terminated_at poisoned")
                    {
                        Some(at) => now.duration_since(at) < ttl,
                        None => true,
                    }
                });
                self.chat_command_receipts.retain(|_, receipt| {
                    now.duration_since(receipt.recorded_at) < CHAT_COMMAND_RECEIPT_TTL
                });
                self.chat_command_locks
                    .retain(|_, lock| lock.strong_count() > 0);
                self.user_input_receipts.retain(|_, receipt| {
                    now.duration_since(receipt.recorded_at) < USER_INPUT_RECEIPT_TTL
                });
                self.pending_user_inputs.retain(|_, pending| {
                    if now.duration_since(pending.created_at) >= USER_INPUT_PENDING_TTL {
                        return false;
                    }
                    let resolution = pending
                        .resolution
                        .lock()
                        .expect("pending user input resolution poisoned");
                    resolution.answers.is_some()
                        || resolution
                            .sender
                            .as_ref()
                            .map(|sender| !sender.is_closed())
                            .unwrap_or(false)
                });
            }
        });
    }
}

fn validate_user_input_answers(
    questions: &[UserInputQuestion],
    answers: &UserInputAnswers,
) -> Result<(), String> {
    if answers.len() != questions.len() {
        return Err("every user input question requires exactly one answer".to_string());
    }
    for question in questions {
        let answer = answers
            .get(&question.id)
            .ok_or_else(|| format!("missing answer for question `{}`", question.id))?;
        match (question.multi_select, answer) {
            (false, UserInputAnswer::Single(value)) if !value.trim().is_empty() => {}
            (true, UserInputAnswer::Multiple(values))
                if !values.is_empty()
                    && values.len() <= 10
                    && values.iter().all(|value| !value.trim().is_empty()) => {}
            (false, _) => {
                return Err(format!(
                    "question `{}` requires one non-empty string answer",
                    question.id
                ));
            }
            (true, _) => {
                return Err(format!(
                    "question `{}` requires a non-empty string array answer",
                    question.id
                ));
            }
        }
    }
    Ok(())
}

/// Shared forwarder body for [`LiveStreamRegistry::register`] and
/// [`LiveStreamRegistry::register_receiver`]. Pumps every harness frame
/// from `rx` into the stream's replay log, marking the stream terminal
/// on `AssistantMessageEnd` / `Error` (or on cancellation / upstream
/// close). Keeping this single source of truth ensures the owned-session
/// and unowned-receiver paths stay in lockstep on terminal detection.
fn spawn_forwarder(
    stream: Arc<LiveStream>,
    mut rx: broadcast::Receiver<HarnessOutbound>,
    cancel: CancellationToken,
) {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    stream
                        .events
                        .append(serde_json::json!({ "type": "stream_cancelled" }));
                    stream.mark_terminated();
                    break;
                }
                res = rx.recv() => match res {
                    Ok(evt) => {
                        let terminal = matches!(
                            evt,
                            HarnessOutbound::AssistantMessageEnd(_) | HarnessOutbound::Error(_)
                        );
                        if let Ok(value) = serde_json::to_value(&evt) {
                            stream.events.append(value);
                        }
                        if terminal {
                            stream.mark_terminated();
                            break;
                        }
                    }
                    // The forwarder is the source of truth for resumable
                    // replay. If it loses frames, record a terminal protocol
                    // error instead of presenting a silently incomplete run.
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        warn!(
                            target: "aura::streams",
                            attach_id = %stream.attach_id,
                            skipped,
                            "live stream replay forwarder lagged; retaining terminal integrity error"
                        );
                        let error = HarnessOutbound::Error(ErrorMsg {
                            code: "live_stream_replay_lagged".to_string(),
                            message: format!(
                                "Live stream replay lost {skipped} event(s) before they could be retained"
                            ),
                            recoverable: true,
                            support_id: None,
                        });
                        if let Ok(value) = serde_json::to_value(error) {
                            stream.events.append(value);
                        }
                        stream.mark_terminated();
                        break;
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        stream.mark_terminated();
                        break;
                    }
                }
            }
        }
        debug!(
            target: "aura::streams",
            attach_id = %stream.attach_id,
            latest_seq = stream.events.latest_seq(),
            "live stream forwarder terminated"
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use aura_os_harness::{ErrorMsg, HarnessSession, TextDelta};
    use aura_protocol::ToolApprovalPrompt;
    use tokio::sync::mpsc;

    fn fake_session() -> HarnessSession {
        let (events_tx, _) = broadcast::channel(16);
        let (raw_events_tx, _) = broadcast::channel(16);
        let (commands_tx, _commands_rx) = mpsc::channel(16);
        HarnessSession {
            session_id: "sess-1".to_string(),
            run_id: "run-1".to_string(),
            events_tx,
            raw_events_tx,
            commands_tx,
            pending_events: Vec::new(),
            events_rx: None,
            raw_events_rx: Vec::new(),
        }
    }

    fn test_registry() -> Arc<LiveStreamRegistry> {
        Arc::new(LiveStreamRegistry {
            inner: DashMap::new(),
            chat_command_receipts: DashMap::new(),
            chat_command_locks: DashMap::new(),
            pending_user_inputs: DashMap::new(),
            user_input_receipts: DashMap::new(),
            stream_capacity: 64,
            ttl: Duration::from_secs(300),
        })
    }

    fn sample_questions() -> Vec<UserInputQuestion> {
        vec![
            UserInputQuestion {
                id: "environment".to_string(),
                header: "Environment".to_string(),
                question: "Where should I run this?".to_string(),
                options: vec![
                    UserInputQuestionOption {
                        label: "Hosted".to_string(),
                        description: "Run on Aura's hosted environment.".to_string(),
                    },
                    UserInputQuestionOption {
                        label: "Desktop".to_string(),
                        description: "Run on the connected desktop.".to_string(),
                    },
                ],
                multi_select: false,
            },
            UserInputQuestion {
                id: "checks".to_string(),
                header: "Checks".to_string(),
                question: "Which checks should I run?".to_string(),
                options: vec![
                    UserInputQuestionOption {
                        label: "Tests".to_string(),
                        description: "Run the focused test suite.".to_string(),
                    },
                    UserInputQuestionOption {
                        label: "Lint".to_string(),
                        description: "Run the relevant lint checks.".to_string(),
                    },
                ],
                multi_select: true,
            },
        ]
    }

    #[tokio::test]
    async fn structured_user_input_is_owner_scoped_and_idempotent() {
        let registry = test_registry();
        let registration = registry.register_user_input(
            "owner".to_string(),
            "agent-1".to_string(),
            Some("project-1".to_string()),
            Some("instance-1".to_string()),
            Some("session-1".to_string()),
            sample_questions(),
        );
        let request_id = registration.summary.request_id.clone();
        assert!(registry.list_pending_user_inputs("someone-else").is_empty());
        assert_eq!(registry.list_pending_user_inputs("owner").len(), 1);

        let answers = HashMap::from([
            (
                "environment".to_string(),
                UserInputAnswer::Single("Hosted".to_string()),
            ),
            (
                "checks".to_string(),
                UserInputAnswer::Multiple(vec!["Tests".to_string(), "Lint".to_string()]),
            ),
        ]);
        assert!(registry
            .respond_to_user_input("someone-else", &request_id, answers.clone())
            .is_err());
        registry
            .respond_to_user_input("owner", &request_id, answers.clone())
            .expect("owner should resolve the question");
        assert!(registry.list_pending_user_inputs("owner").is_empty());
        assert_eq!(registration.receiver.await.unwrap(), answers);

        registry.finish_user_input(&request_id);
        registry
            .respond_to_user_input("owner", &request_id, answers.clone())
            .expect("same retry should use the receipt");
        let changed = HashMap::from([
            (
                "environment".to_string(),
                UserInputAnswer::Single("Desktop".to_string()),
            ),
            (
                "checks".to_string(),
                UserInputAnswer::Multiple(vec!["Tests".to_string()]),
            ),
        ]);
        assert!(registry
            .respond_to_user_input("owner", &request_id, changed)
            .unwrap_err()
            .contains("differently"));
    }

    #[test]
    fn structured_user_input_rejects_partial_or_wrong_answer_shapes() {
        let registry = test_registry();
        let registration = registry.register_user_input(
            "owner".to_string(),
            "agent-1".to_string(),
            None,
            None,
            Some("session-1".to_string()),
            sample_questions(),
        );
        let request_id = registration.summary.request_id;

        let partial = HashMap::from([(
            "environment".to_string(),
            UserInputAnswer::Single("Hosted".to_string()),
        )]);
        assert!(registry
            .respond_to_user_input("owner", &request_id, partial)
            .unwrap_err()
            .contains("every user input question"));

        let wrong_shape = HashMap::from([
            (
                "environment".to_string(),
                UserInputAnswer::Multiple(vec!["Hosted".to_string()]),
            ),
            (
                "checks".to_string(),
                UserInputAnswer::Single("Tests".to_string()),
            ),
        ]);
        assert!(registry
            .respond_to_user_input("owner", &request_id, wrong_shape)
            .unwrap_err()
            .contains("requires one"));
    }

    #[tokio::test]
    async fn chat_command_receipts_are_user_scoped_and_attach_to_original_stream() {
        let registry = test_registry();
        registry.record_chat_command(
            Some("user-1"),
            "command-1",
            "session-1",
            "project-1",
            "hello",
        );
        registry.record_chat_command(
            Some("user-2"),
            "command-1",
            "session-2",
            "project-2",
            "other",
        );

        let first = registry
            .find_chat_command(Some("user-1"), "command-1")
            .expect("first user receipt");
        assert_eq!(first.session_id, "session-1");
        assert_eq!(first.content, "hello");
        assert!(first.stream.is_none());

        let stream = registry.register(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("user-1".into()),
                session_id: Some("session-1".into()),
                ..Default::default()
            },
            fake_session(),
        );
        registry.attach_chat_command(Some("user-1"), "command-1", &stream.attach_id);

        let attached = registry
            .find_chat_command(Some("user-1"), "command-1")
            .expect("attached receipt");
        assert_eq!(
            attached.stream.expect("original stream").attach_id,
            stream.attach_id
        );
        assert_eq!(
            registry
                .find_chat_command(Some("user-2"), "command-1")
                .expect("second user receipt")
                .session_id,
            "session-2"
        );
    }

    #[test]
    fn chat_command_locks_serialize_only_the_same_user_and_id() {
        let registry = test_registry();
        let first = registry.chat_command_lock(Some("user-1"), "command-1");
        let same = registry.chat_command_lock(Some("user-1"), "command-1");
        let other_user = registry.chat_command_lock(Some("user-2"), "command-1");
        let other_command = registry.chat_command_lock(Some("user-1"), "command-2");

        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &other_user));
        assert!(!Arc::ptr_eq(&first, &other_command));
    }

    #[tokio::test]
    async fn forwarder_records_frames_and_marks_terminal() {
        let registry = test_registry();
        let session = fake_session();
        let events_tx = session.events_tx.clone();
        let scope = StreamScope {
            user_id: Some("u1".to_string()),
            project_id: Some("p1".to_string()),
            ..Default::default()
        };
        let stream = registry.register(StreamKind::SpecGen, scope, session);

        // A non-terminal frame is recorded and the stream stays live.
        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "hello".to_string(),
            }))
            .unwrap();
        // A terminal frame ends it.
        events_tx
            .send(HarnessOutbound::Error(ErrorMsg {
                code: "boom".to_string(),
                message: "boom".to_string(),
                recoverable: false,
                support_id: None,
            }))
            .unwrap();

        // Let the forwarder drain.
        for _ in 0..50 {
            if stream.is_terminated() && stream.events.latest_seq() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(stream.is_terminated(), "terminal frame should end stream");
        assert_eq!(stream.events.latest_seq(), 2, "both frames recorded");

        let summary = stream.summary();
        assert_eq!(summary.kind, StreamKind::SpecGen);
        assert!(summary.terminated);
        assert_eq!(summary.latest_seq, 2);
    }

    #[tokio::test]
    async fn list_for_scope_filters_by_user_and_project() {
        let registry = test_registry();
        let s1 = registry.register(
            StreamKind::SpecGen,
            StreamScope {
                user_id: Some("u1".to_string()),
                project_id: Some("p1".to_string()),
                ..Default::default()
            },
            fake_session(),
        );
        let _s2 = registry.register(
            StreamKind::SpecGen,
            StreamScope {
                user_id: Some("u2".to_string()),
                project_id: Some("p1".to_string()),
                ..Default::default()
            },
            fake_session(),
        );

        let mine = registry.list_for_scope("u1", None, None);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].attach_id, s1.attach_id);

        let mine_p2 = registry.list_for_scope("u1", Some("p2"), None);
        assert!(mine_p2.is_empty(), "project filter excludes p1 stream");

        let mine_p1 = registry.list_for_scope("u1", Some("p1"), None);
        assert_eq!(mine_p1.len(), 1);
    }

    #[tokio::test]
    async fn active_summary_reports_only_redacted_activity() {
        let registry = test_registry();
        let stream = registry.register(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("u1".to_string()),
                session_id: Some("sess-1".to_string()),
                ..Default::default()
            },
            fake_session(),
        );
        stream.events.append(serde_json::json!({
            "type": "tool_call_snapshot",
            "id": "tool-1",
            "name": "read_file",
            "input": { "path": "/private/workspace/secrets.rs" },
        }));

        let summary = stream.summary();
        assert_eq!(summary.activity.as_deref(), Some("Inspecting code"));
        let serialized = serde_json::to_string(&summary).expect("summary serializes");
        assert!(!serialized.contains("secrets.rs"));
        assert!(!serialized.contains("/private/workspace"));
    }

    #[test]
    fn redacted_activity_uses_generic_labels_for_unknown_tools() {
        assert_eq!(
            redacted_stream_activity(&serde_json::json!({
                "type": "tool_use_start",
                "name": "private_customer_plugin",
            }))
            .as_deref(),
            Some("Using a tool"),
        );
        assert_eq!(
            redacted_stream_activity(&serde_json::json!({
                "type": "progress",
                "stage": "tool_running",
                "tool_name": "run_command",
                "message": "running: printenv SECRET_TOKEN",
            }))
            .as_deref(),
            Some("Running a command"),
        );
    }

    #[tokio::test]
    async fn register_receiver_records_frames_and_marks_terminal() {
        let registry = test_registry();
        // The receiver path does NOT own the session: the broadcast
        // sender lives on the caller's side (here, the test), mirroring
        // the reused chat session in `chat_sessions`.
        let (events_tx, _rx0) = broadcast::channel::<HarnessOutbound>(16);
        let scope = StreamScope {
            user_id: Some("u1".to_string()),
            project_id: Some("p1".to_string()),
            session_id: Some("sess-1".to_string()),
            ..Default::default()
        };
        let stream =
            registry.register_receiver(StreamKind::ChatTurn, scope, events_tx.subscribe(), None);

        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "hello".to_string(),
            }))
            .unwrap();
        events_tx
            .send(HarnessOutbound::Error(ErrorMsg {
                code: "boom".to_string(),
                message: "boom".to_string(),
                recoverable: false,
                support_id: None,
            }))
            .unwrap();

        for _ in 0..50 {
            if stream.is_terminated() && stream.events.latest_seq() >= 2 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(stream.is_terminated(), "terminal frame should end stream");
        assert_eq!(stream.events.latest_seq(), 2, "both frames recorded");

        let summary = stream.summary();
        assert_eq!(summary.kind, StreamKind::ChatTurn);
        assert!(summary.terminated);
        assert_eq!(summary.latest_seq, 2);
    }

    #[tokio::test]
    async fn terminated_replay_releases_command_sender() {
        let registry = test_registry();
        let (events_tx, _) = broadcast::channel::<HarnessOutbound>(16);
        let (commands_tx, mut commands_rx) = mpsc::channel(4);
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope::default(),
            events_tx.subscribe(),
            Some(commands_tx),
        );
        events_tx
            .send(HarnessOutbound::Error(ErrorMsg {
                code: "finished".into(),
                message: "terminal".into(),
                recoverable: false,
                support_id: None,
            }))
            .unwrap();

        assert!(
            tokio::time::timeout(Duration::from_secs(1), commands_rx.recv())
                .await
                .expect("completed replay must release the transport sender")
                .is_none()
        );
        assert!(stream.is_terminated());
        let retained = registry
            .get(&stream.attach_id)
            .expect("replay is still retained");
        let crate::event_log::ReplayResult::Replay { events, .. } = retained.events.replay_since(0)
        else {
            panic!("terminal event must remain replayable");
        };
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].value["code"], "finished");
    }

    #[tokio::test]
    async fn cancelling_terminated_replay_does_not_cancel_reused_session() {
        let registry = test_registry();
        let (events_tx, _) = broadcast::channel::<HarnessOutbound>(16);
        let (commands_tx, mut commands_rx) = mpsc::channel(4);
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope::default(),
            events_tx.subscribe(),
            Some(commands_tx.clone()),
        );
        stream.mark_terminated();
        stream.cancel();
        assert!(
            matches!(
                commands_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ),
            "a stale replay must not send Cancel into a later turn"
        );
        drop(commands_tx);
        assert!(commands_rx.recv().await.is_none());
    }

    #[tokio::test]
    async fn register_receiver_surfaces_lag_as_terminal_replay_error() {
        let registry = test_registry();
        let (events_tx, events_rx) = broadcast::channel::<HarnessOutbound>(1);
        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "overwritten".to_string(),
            }))
            .unwrap();
        events_tx
            .send(HarnessOutbound::TextDelta(TextDelta {
                text: "latest".to_string(),
            }))
            .unwrap();

        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope::default(),
            events_rx,
            None,
        );
        for _ in 0..50 {
            if stream.is_terminated() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(stream.is_terminated());
        let crate::event_log::ReplayResult::Replay { events, .. } = stream.events.replay_since(0)
        else {
            panic!("terminal replay error must be retained");
        };
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].value["type"], "error");
        assert_eq!(events[0].value["code"], "live_stream_replay_lagged");
    }

    #[tokio::test]
    async fn register_receiver_lists_and_filters_by_scope() {
        let registry = test_registry();
        let (tx1, _r1) = broadcast::channel::<HarnessOutbound>(16);
        let (tx2, _r2) = broadcast::channel::<HarnessOutbound>(16);
        let s1 = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("u1".to_string()),
                project_id: Some("p1".to_string()),
                session_id: Some("sess-a".to_string()),
                ..Default::default()
            },
            tx1.subscribe(),
            None,
        );
        let _s2 = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("u2".to_string()),
                project_id: Some("p1".to_string()),
                session_id: Some("sess-b".to_string()),
                ..Default::default()
            },
            tx2.subscribe(),
            None,
        );

        let mine = registry.list_for_scope("u1", None, None);
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].attach_id, s1.attach_id);

        let mine_p2 = registry.list_for_scope("u1", Some("p2"), None);
        assert!(mine_p2.is_empty(), "project filter excludes p1 stream");
    }

    /// The unowned-receiver path's `cancel()` must additionally forward
    /// `HarnessInbound::Cancel` over the stored command channel (the
    /// owned-session path relies on dropping the session instead).
    #[tokio::test]
    async fn register_receiver_cancel_forwards_harness_cancel() {
        let registry = test_registry();
        let (events_tx, _rx0) = broadcast::channel::<HarnessOutbound>(16);
        let (commands_tx, mut commands_rx) = mpsc::channel(4);
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope::default(),
            events_tx.subscribe(),
            Some(commands_tx),
        );

        stream.cancel();

        let observed = tokio::time::timeout(Duration::from_millis(200), commands_rx.recv())
            .await
            .expect("cancel should forward a command before timeout")
            .expect("commands_tx still open");
        assert!(
            matches!(observed, HarnessInbound::Cancel),
            "cancel must forward HarnessInbound::Cancel, got {observed:?}",
        );

        // The forwarder also observes the cancellation token and marks
        // the stream terminal with a synthetic frame.
        for _ in 0..50 {
            if stream.is_terminated() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(
            stream.is_terminated(),
            "cancel should mark the stream terminal"
        );
    }

    #[tokio::test]
    async fn mobile_client_can_resolve_and_answer_chat_tool_approval_by_request_id() {
        let registry = test_registry();
        let (events_tx, _rx0) = broadcast::channel::<HarnessOutbound>(16);
        let (commands_tx, mut commands_rx) = mpsc::channel(4);
        let stream = registry.register_receiver(
            StreamKind::ChatTurn,
            StreamScope {
                user_id: Some("owner".to_string()),
                agent_id: Some("template-agent-1".to_string()),
                session_id: Some("desktop-session".to_string()),
                ..Default::default()
            },
            events_tx.subscribe(),
            Some(commands_tx),
        );

        events_tx
            .send(HarnessOutbound::ToolApprovalPrompt(ToolApprovalPrompt {
                request_id: "approval-1".to_string(),
                tool_name: "write_file".to_string(),
                args: serde_json::json!({ "path": "src/main.rs" }),
                agent_id: "agent-1".to_string(),
                remember_options: vec![ToolApprovalRemember::Once],
            }))
            .expect("approval prompt should enter the live stream");

        for _ in 0..50 {
            if stream.events.latest_seq() >= 1 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }

        assert!(
            registry
                .find_chat_tool_approval("someone-else", "approval-1")
                .is_none(),
            "another account must not resolve the owner's approval"
        );
        assert!(
            registry
                .list_pending_tool_approvals("someone-else")
                .is_empty(),
            "another account must not discover the owner's approval"
        );
        let pending = registry.list_pending_tool_approvals("owner");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].request_id, "approval-1");
        assert_eq!(pending[0].agent_id, "template-agent-1");
        assert_eq!(pending[0].session_id.as_deref(), Some("desktop-session"));
        let resolved = registry
            .find_chat_tool_approval("owner", "approval-1")
            .expect("the owning mobile client should resolve the desktop-started prompt");
        resolved
            .respond_to_tool_approval(
                "approval-1".to_string(),
                ToolApprovalDecision::On,
                ToolApprovalRemember::Once,
            )
            .expect("approval response should reach the live harness channel");

        let observed = tokio::time::timeout(Duration::from_millis(200), commands_rx.recv())
            .await
            .expect("approval should be forwarded before timeout")
            .expect("command channel should stay open");
        let HarnessInbound::ToolApprovalResponse(response) = observed else {
            panic!("expected tool approval response");
        };
        assert_eq!(response.request_id, "approval-1");
        assert_eq!(response.decision, ToolApprovalDecision::On);
        assert_eq!(response.remember, ToolApprovalRemember::Once);

        resolved
            .respond_to_tool_approval(
                "approval-1".to_string(),
                ToolApprovalDecision::On,
                ToolApprovalRemember::Once,
            )
            .expect("an uncertain client retry should be idempotently accepted");
        assert!(
            matches!(
                commands_rx.try_recv(),
                Err(mpsc::error::TryRecvError::Empty)
            ),
            "the same approval request must only be forwarded once"
        );
        let crate::event_log::ReplayResult::Replay { events, .. } = resolved.events.replay_since(0)
        else {
            panic!("approval stream should retain its replay frames");
        };
        assert_eq!(
            events.last().unwrap().value["type"],
            "tool_approval_resolved"
        );
        assert!(
            registry.list_pending_tool_approvals("owner").is_empty(),
            "resolved approvals must disappear from cold-start snapshots"
        );

        let conflicting = resolved.respond_to_tool_approval(
            "approval-1".to_string(),
            ToolApprovalDecision::Off,
            ToolApprovalRemember::Once,
        );
        assert!(conflicting.is_err(), "a conflicting retry must be rejected");

        events_tx
            .send(HarnessOutbound::ToolApprovalPrompt(ToolApprovalPrompt {
                request_id: "approval-2".to_string(),
                tool_name: "run_command".to_string(),
                args: serde_json::json!({ "command": "cargo test" }),
                agent_id: "agent-1".to_string(),
                remember_options: vec![ToolApprovalRemember::Once],
            }))
            .expect("second approval prompt should enter the live stream");
        for _ in 0..50 {
            if stream.events.latest_seq() >= 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let unavailable_scope = resolved.respond_to_tool_approval(
            "approval-2".to_string(),
            ToolApprovalDecision::On,
            ToolApprovalRemember::Forever,
        );
        assert!(
            unavailable_scope.is_err(),
            "unoffered scopes must be rejected"
        );
    }
}
