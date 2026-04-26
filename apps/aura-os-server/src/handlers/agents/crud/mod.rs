//! CRUD handlers for the agent resource. Split out of the original
//! `crud.rs` (1.4k lines) into focused submodules to honor the 500-line cap
//! and make the swarm/recovery flows discoverable on their own.
//!
//! Submodules:
//! * [`validation`] — name format checks and runtime-config builder
//! * [`swarm`]      — Swarm gateway provisioning, recovery, readiness polling
//! * [`create`]     — `POST /agents`
//! * [`list`]       — `GET /agents`, `GET /agents/{id}`, `ListAgentsQuery`
//! * [`update`]     — `PUT /agents/{id}`
//! * [`delete`]     — `DELETE /agents/{id}`, project-binding helpers

mod create;
mod delete;
mod list;
mod swarm;
mod update;
mod validation;

pub(crate) use create::create_agent;
pub(crate) use delete::{delete_agent, list_agent_project_bindings, remove_agent_project_binding};
pub(crate) use list::{get_agent, list_agents};
pub(crate) use swarm::recover_remote_agent_pipeline;
pub(crate) use update::update_agent;
