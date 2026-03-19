//! Orbit REST client for Aura–Orbit integration.
//!
//! All requests use the same zero-auth JWT as aura-network (`Authorization: Bearer <jwt>`).
//! Owner is always an Aura org_id or user_id (UUID from aura-storage).

mod client;
mod error;
mod types;

pub use client::OrbitClient;
pub use error::OrbitError;
pub use types::{CreateRepoResponse, OrbitRepo};
