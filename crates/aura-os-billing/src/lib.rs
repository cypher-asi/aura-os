#![warn(missing_docs)]

pub mod client;
pub mod error;

#[cfg(any(test, feature = "test-utils"))]
pub mod testutil;

pub use client::BillingClient;
pub use error::BillingError;
