//! Headless browser session management plus project-aware initial URL
//! resolution for aura-os.
//!
//! This crate provides:
//!
//! - [`BrowserManager`] — a registry of live browser sessions backed by a
//!   pluggable [`BrowserBackend`] trait. The default
//!   [`backend::StubBackend`] returns structured errors when asked to drive
//!   a page; the production backend (a headless Chromium CDP client) plugs
//!   in via the same trait in a follow-up.
//! - A per-project settings system that persists the user's pinned URL,
//!   last-visited URL, and a rolling list of auto-detected dev-server URLs
//!   to a local JSON file (see [`session::settings`]).
//! - A passive terminal-output URL scraper ([`session::discovery`]) and an
//!   active localhost port probe ([`session::probe`]).
//! - An initial URL resolver ([`session::resolver`]) that picks a smart
//!   default URL when a new browser session is opened inside a project.
//!
//! The crate never depends on `axum` or any web framework; the server app
//! wires it to HTTP/WebSocket routes.
#![warn(missing_docs)]

pub mod backend;
pub mod config;
pub mod error;
pub mod manager;
pub mod protocol;
pub mod session;

pub use backend::{BrowserBackend, StubBackend};
pub use config::{BrowserConfig, ResolveOptions, SpawnOptions};
pub use error::Error;
pub use manager::{BrowserManager, SessionInfo};
pub use protocol::{
    encode_frame_header, parse_frame_header, ClientMsg, FrameHeader, MouseButton, MouseEventKind,
    NavState, ServerEvent, FRAME_HEADER_LEN, FRAME_OPCODE,
};
pub use session::{
    DetectedUrl, DetectionSource, HistoryEntry, ProjectBrowserSettings, SessionHandle, SessionId,
    SettingsPatch, SettingsStore,
};
