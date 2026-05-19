//! `POST /v1/projects/:project_id/agents/:instance_id/chat/stream` route. Runs an agent instance chat turn — refreshes permissions from the parent template, builds the project-aware system prompt, and hands off to the SSE driver.

mod client_retry;
mod helpers;
mod project_prompt;
mod route;

pub(super) use client_retry::header_indicates_client_retry;
pub(crate) use project_prompt::build_project_system_prompt;
pub(crate) use route::send_event_stream;

#[cfg(test)]
pub(crate) use project_prompt::{render_project_context, render_project_context_fallback};
