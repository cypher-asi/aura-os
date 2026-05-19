//! Task-context resolver shared by the dev-loop and chat agent's
//! `get_task_context` tool surface.
//!
//! Phase G4a / Section F2. The harness exposes a `get_task_context`
//! tool that today returns an empty payload, forcing the agent into
//! expensive file exploration to rebuild what the server already
//! knows. This module owns the pure shaping + caching layer the
//! server's tool wiring will use to populate the response with
//! `title`, `description`, `spec`, `status`, immediate `parent` /
//! `children`, recent `execution_notes`, and the `task_version`.
//!
//! ## Layout
//!
//! * [`build_task_context`] — pure builder that takes a `&Task`,
//!   pre-fetched parent/children references, optional spec body, and
//!   a version stamp; performs no I/O.
//! * [`TaskContextResolver`] — bounded `(TaskId, version)`-keyed
//!   cache wrapping [`build_task_context`]. The server hands it a
//!   small `fetcher` closure that does the storage round-trip on
//!   miss; consecutive calls within one run hit the cache.
//! * [`TaskContext`] / [`TaskRef`] — wire types serialized straight
//!   into the tool result.
//!
//! Each piece lives in its own file so a single edit does not push
//! the module past `.cursor/rules-rust.md`'s 500-line ceiling.

pub mod cache;
pub mod resolver;

#[cfg(test)]
mod tests;

pub use cache::{TaskContextCache, MAX_CACHE_ENTRIES};
pub use resolver::{
    build_task_context, TaskContext, TaskContextInputs, TaskContextResolver, TaskRef,
    MAX_EXECUTION_NOTES_LEN,
};
