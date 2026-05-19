//! Pure builder + cached resolver for [`TaskContext`] payloads.

use std::sync::Arc;

use aura_os_core::{Task, TaskId, TaskStatus};
use serde::{Deserialize, Serialize};

use crate::error::AutomationError;

use super::cache::TaskContextCache;

/// Maximum number of characters preserved from the task's recent
/// `execution_notes` body before truncation. 1 KiB comfortably fits
/// the most recent fail reason / synthesized note while keeping the
/// tool-result payload well inside the harness's `~4–8 KB` budget.
pub const MAX_EXECUTION_NOTES_LEN: usize = 1024;

/// Wire-shape returned to the agent. `serde::Serialize` so the
/// server's tool wiring can hand it straight to
/// `serde_json::to_value` without an intermediate struct.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskContext {
    /// The task whose context is being returned.
    pub task_id: TaskId,
    /// Short human-readable title.
    pub title: String,
    /// Full task description body.
    pub description: String,
    /// Optional spec body. `None` when the caller did not supply one
    /// or when the resolved spec was empty after trimming.
    pub spec: Option<String>,
    /// Current task status.
    pub status: TaskStatus,
    /// Immediate parent task, if any.
    pub parent: Option<TaskRef>,
    /// Direct child tasks. Ordered as the caller supplied them
    /// (typically by `order_index`).
    pub children: Vec<TaskRef>,
    /// Tail of the task's `execution_notes`, truncated to
    /// [`MAX_EXECUTION_NOTES_LEN`] characters. `None` when notes
    /// were empty.
    pub recent_execution_notes: Option<String>,
    /// Stamp the cache uses to invalidate stale entries. Callers
    /// typically derive this from the storage row's `updated_at`.
    pub task_version: u64,
}

/// Lightweight reference shipped inside [`TaskContext::parent`] and
/// [`TaskContext::children`]. Avoids embedding a full `Task` per
/// edge so a task with many neighbours stays inside the harness's
/// tool-result budget.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskRef {
    /// Identifier of the referenced task.
    pub task_id: TaskId,
    /// Human-readable title of the referenced task.
    pub title: String,
    /// Current status of the referenced task.
    pub status: TaskStatus,
}

/// Inputs to [`build_task_context`]. Bundling them as a struct keeps
/// the builder's signature inside the 5-parameter ceiling from
/// `.cursor/rules-rust.md` while still letting the caller pass each
/// field by reference / value as natural for the call site.
#[derive(Debug, Clone)]
pub struct TaskContextInputs<'a> {
    /// Task the agent asked for.
    pub task: &'a Task,
    /// Pre-fetched parent task, if `task.parent_task_id` was set.
    pub parent: Option<&'a Task>,
    /// Pre-fetched direct children. The builder copies the
    /// `(task_id, title, status)` projection out so the slice can
    /// be dropped immediately after the call.
    pub children: &'a [Task],
    /// Spec body resolved by the caller. Trimmed and dropped when
    /// empty.
    pub spec: Option<&'a str>,
    /// Stamp used as the cache version. Typically the storage row's
    /// `updated_at` epoch seconds; any monotone-per-task `u64` works.
    pub task_version: u64,
}

/// Pure builder. Performs no I/O; all dependency lookups must be
/// resolved by the caller before invocation.
///
/// Long bodies are accepted unchanged for `title` and `description`
/// (those are bounded by the storage column sizes and the harness
/// truncates the final tool result if the agent overflows the
/// model's context). Only `recent_execution_notes` is truncated
/// here because it can grow without bound across retries.
#[must_use]
pub fn build_task_context(inputs: &TaskContextInputs<'_>) -> TaskContext {
    let TaskContextInputs {
        task,
        parent,
        children,
        spec,
        task_version,
    } = inputs;

    let parent_ref = parent.map(|task| TaskRef {
        task_id: task.task_id,
        title: task.title.clone(),
        status: task.status,
    });
    let children_refs = children
        .iter()
        .map(|task| TaskRef {
            task_id: task.task_id,
            title: task.title.clone(),
            status: task.status,
        })
        .collect::<Vec<_>>();

    TaskContext {
        task_id: task.task_id,
        title: task.title.clone(),
        description: task.description.clone(),
        spec: spec
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        status: task.status,
        parent: parent_ref,
        children: children_refs,
        recent_execution_notes: trim_execution_notes(&task.execution_notes),
        task_version: *task_version,
    }
}

/// Tail-truncate `notes` to [`MAX_EXECUTION_NOTES_LEN`] characters.
/// Returns `None` for an all-whitespace input so the wire payload
/// does not carry an empty placeholder string. When a tail is
/// taken, an `…` ellipsis is prefixed so the agent can tell the
/// notes were clipped.
fn trim_execution_notes(notes: &str) -> Option<String> {
    let trimmed = notes.trim();
    if trimmed.is_empty() {
        return None;
    }
    let total = trimmed.chars().count();
    if total <= MAX_EXECUTION_NOTES_LEN {
        return Some(trimmed.to_string());
    }
    let skip = total.saturating_sub(MAX_EXECUTION_NOTES_LEN.saturating_sub(1));
    let tail: String = trimmed.chars().skip(skip).collect();
    Some(format!("…{tail}"))
}

/// Cached front-door. Holds a [`TaskContextCache`] and resolves
/// misses through a caller-supplied `fetcher`.
///
/// `Resolver` is `Clone` (cheap: bumps the inner `Arc`) so the
/// server can stash it on `AppState` and clone for every request.
#[derive(Debug, Clone, Default)]
pub struct TaskContextResolver {
    cache: TaskContextCache,
}

/// Output of a [`TaskFetcher`] invocation. The caller assembles the
/// task plus its immediate neighbours and any spec body it has
/// already loaded; the resolver builds the wire context and caches
/// the result.
///
/// The resolver does not own storage; the fetcher returns owned
/// values so the cache can hold the resulting [`TaskContext`]
/// independently of the storage client's lifetime.
#[derive(Debug, Clone)]
pub struct FetchedTask {
    /// Primary task fetched.
    pub task: Task,
    /// Immediate parent task, if any.
    pub parent: Option<Task>,
    /// Direct children, ordered as storage returned them.
    pub children: Vec<Task>,
    /// Optional spec body to embed.
    pub spec: Option<String>,
}

/// Fetcher contract. The resolver passes the requested `task_id`
/// and a hint of the caller-known `version`; production
/// implementations typically discard the hint and trust whatever
/// the storage row currently shows. Tests can inject a stub that
/// counts invocations to verify cache hits.
pub trait TaskFetcher {
    /// Resolve `task_id` to a [`FetchedTask`] bundle, or surface
    /// an [`AutomationError`] when the lookup fails.
    fn fetch(&self, task_id: TaskId) -> Result<FetchedTask, AutomationError>;
}

impl<F> TaskFetcher for F
where
    F: Fn(TaskId) -> Result<FetchedTask, AutomationError>,
{
    fn fetch(&self, task_id: TaskId) -> Result<FetchedTask, AutomationError> {
        (self)(task_id)
    }
}

impl TaskContextResolver {
    /// Construct a fresh resolver with an empty cache.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Resolve `task_id` at `version`. On cache hit returns the
    /// stored `Arc<TaskContext>`; on miss invokes `fetcher`,
    /// builds a fresh context, caches it, and returns the new
    /// shared handle.
    ///
    /// The version is supplied by the caller so an updated task
    /// (which bumps its `updated_at`) automatically misses and
    /// re-fetches. When the fetcher resolves a different version
    /// than requested (race against a concurrent update), the
    /// resolver caches under the *resolved* version so the next
    /// caller using the new version short-circuits.
    pub fn resolve<F>(
        &self,
        task_id: TaskId,
        version: u64,
        fetcher: F,
    ) -> Result<Arc<TaskContext>, AutomationError>
    where
        F: TaskFetcher,
    {
        if let Some(cached) = self.cache.get(task_id, version) {
            return Ok(cached);
        }
        let fetched = fetcher.fetch(task_id)?;
        let context = build_task_context(&TaskContextInputs {
            task: &fetched.task,
            parent: fetched.parent.as_ref(),
            children: fetched.children.as_slice(),
            spec: fetched.spec.as_deref(),
            task_version: version,
        });
        let resolved_version = context.task_version;
        let arc = Arc::new(context);
        self.cache.insert(task_id, resolved_version, arc.clone());
        Ok(arc)
    }

    /// Borrow the underlying cache. Exposed so callers that want
    /// to inspect cache size for metrics / tests do not have to
    /// hold a separate handle.
    #[must_use]
    pub fn cache(&self) -> &TaskContextCache {
        &self.cache
    }
}
