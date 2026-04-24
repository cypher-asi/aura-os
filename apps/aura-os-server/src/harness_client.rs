//! Compatibility re-exports for the harness node client.
//!
//! New code should depend on `aura-os-harness` directly. This module keeps the
//! existing server API stable while the broader tool-system migration lands.

pub use aura_os_harness::{
    bearer_headers, GetHeadResponse, HarnessClient, HarnessClientError, HarnessProbeResult,
    HarnessTxKind, SubmitTxResponse,
};
