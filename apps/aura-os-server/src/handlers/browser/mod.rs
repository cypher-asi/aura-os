//! Axum handlers for the in-app browser.
//!
//! - REST endpoints live in [`rest`] and cover session lifecycle plus the
//!   per-project settings / detection APIs.
//! - The WebSocket handler lives in [`ws`] and wires a live session's
//!   [`ServerEvent`](aura_os_browser::ServerEvent) stream to the client.

mod rest;
mod ws;

pub(crate) use rest::{
    get_project_settings, kill_browser, list_browsers, run_detect, spawn_browser,
    update_project_settings,
};
pub(crate) use ws::ws_browser;
