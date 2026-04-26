//! Networking primitives shared across the desktop binary's startup
//! pipeline: TCP probes, the embedded axum server, and the loopback
//! self-heal that keeps `control_plane_api_base_url` honest.

pub(crate) mod loopback;
pub(crate) mod probe;
pub(crate) mod server;
