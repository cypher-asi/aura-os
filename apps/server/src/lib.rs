mod app_builder;
pub(crate) mod channel_ext;
pub(crate) mod dto;
pub(crate) mod error;
pub(crate) mod handlers;
mod network_bridge;
pub(crate) mod router;
pub(crate) mod session_init;
pub(crate) mod state;

pub use app_builder::build_app_state;
pub use router::{create_router, create_router_with_frontend};
pub use state::AppState;
