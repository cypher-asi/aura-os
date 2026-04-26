//! Comprehensive integration tests for the aura-os-storage client.
//!
//! Each test mirrors a canonical production usage pattern from aura-app:
//! how the server, session service, task service, and persistence layer
//! interact with aura-storage through the `StorageClient`.
//!
//! Tests use the in-memory mock storage server (same routes as the real
//! aura-storage service), accessed via `StorageClient::with_base_url`.

use aura_os_storage::testutil::start_mock_storage;
use aura_os_storage::StorageClient;

pub(crate) const JWT: &str = "test-token";

pub(crate) async fn client() -> StorageClient {
    let (url, _db) = start_mock_storage().await;
    StorageClient::with_base_url(&url)
}

mod agents;
mod e2e;
mod events;
mod sessions;
mod tasks;
