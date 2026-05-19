//! Pinned-session validation: confirm a caller-supplied
//! `pinned_session_id` actually belongs to the project agent before
//! we route a chat turn into it.

use aura_os_core::SessionId;
use aura_os_storage::StorageClient;
use tracing::warn;

/// Outcome of attempting to validate a caller-supplied
/// `pinned_session_id` against the agent's session list. The mismatch
/// arm carries enough detail for the handler to return a structured
/// 400 instead of a generic 500.
///
/// `Matched` carries a typed [`SessionId`] (Tier 3 cleanup); the
/// `Mismatch.session_id` deliberately stays `String` because it is
/// the caller-supplied stringified id we report back in the 400, and
/// matches whatever wire shape the caller sent us regardless of
/// whether it parses as a UUID.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PinnedSessionOutcome {
    /// No pin requested — fall through to the legacy resolution path.
    NotRequested,
    /// Pin matched a session that belongs to this agent — use as-is.
    Matched(SessionId),
    /// Pin pointed at a session that does not belong to this agent.
    Mismatch { session_id: String },
}

/// Validate that `pinned_session_id` belongs to the project agent
/// before we wire it into persistence. Returning a structured result
/// (vs. silently falling back to the latest session) lets callers
/// surface a 400 to the UI and avoids scribbling messages from one
/// session into another.
pub(crate) async fn try_pin_session(
    storage: &StorageClient,
    jwt: &str,
    project_agent_id: &str,
    pinned_session_id: Option<&SessionId>,
) -> PinnedSessionOutcome {
    let Some(pinned) = pinned_session_id else {
        return PinnedSessionOutcome::NotRequested;
    };
    // Stringify once at the storage boundary; the in-memory id stays
    // typed for downstream consumers.
    let pinned_str = pinned.to_string();
    match storage.list_sessions(project_agent_id, jwt).await {
        Ok(sessions) => {
            if sessions.iter().any(|s| s.id == pinned_str) {
                PinnedSessionOutcome::Matched(*pinned)
            } else {
                PinnedSessionOutcome::Mismatch {
                    session_id: pinned_str,
                }
            }
        }
        Err(e) => {
            warn!(
                %project_agent_id,
                error = %e,
                "Failed to list sessions while validating pinned session_id; treating as mismatch"
            );
            PinnedSessionOutcome::Mismatch {
                session_id: pinned_str,
            }
        }
    }
}

#[cfg(test)]
mod pin_tests {
    //! Pin down the contract for `try_pin_session` and
    //! `resolve_chat_session_with_pin`. Both functions guard the chat
    //! handler against routing a turn into the wrong session when the
    //! UI's `?session=` query param disagrees with storage. These
    //! tests use the in-memory mock storage so we don't need to pay
    //! the cost of a real backend.

    use std::sync::Arc;

    use aura_os_core::SessionId;
    use aura_os_sessions::SessionService;
    use aura_os_storage::testutil::start_mock_storage;
    use aura_os_storage::{CreateSessionRequest, StorageClient};

    use super::super::context::{ChatPersistRequest, ChatSessionResolveDeps};
    use super::super::resolve::resolve_chat_session_with_pin;
    use super::{try_pin_session, PinnedSessionOutcome};

    /// Build a minimal `SessionService` wired to the same mock storage
    /// the rest of these tests use, so `resolve_chat_session_with_pin`
    /// can route through the auto-fork check without reaching for a
    /// real aura-storage backend.
    fn test_session_service(storage: Arc<StorageClient>) -> SessionService {
        let tmp = tempfile::TempDir::new().expect("temp dir for SettingsStore");
        let store = Arc::new(
            aura_os_store::SettingsStore::open(tmp.path())
                .expect("SettingsStore should open in temp dir"),
        );
        // Leak the temp dir so the SettingsStore stays alive for the
        // lifetime of the test process; mirrors what `fixture` does for
        // the storage `_db` handle below.
        std::mem::forget(tmp);
        SessionService::new(store, 0.8, 200_000).with_storage_client(Some(storage))
    }

    /// Helper: spin up the mock storage and create one session for
    /// `agent_id` so the tests have a real session id to pin. Returns
    /// the typed [`SessionId`] (the mock storage hands back a UUID by
    /// construction, so the parse always succeeds in tests).
    async fn fixture(agent_id: &str) -> (StorageClient, SessionId) {
        let (url, _db) = start_mock_storage().await;
        let storage = StorageClient::with_base_url(&url);
        let session = storage
            .create_session(
                agent_id,
                "jwt",
                &CreateSessionRequest {
                    project_id: "project-x".to_string(),
                    org_id: None,
                    model: None,
                    status: Some("active".to_string()),
                    context_usage_estimate: None,
                    summary_of_previous_context: None,
                },
            )
            .await
            .expect("mock storage create_session");
        // Leak the temp DB so it lives for the whole test — the
        // returned client only needs the URL to keep talking to it.
        // The mock handle going out of scope here is fine because the
        // server task holds the DB alive for the test process.
        std::mem::forget(_db);
        let sid: SessionId = session
            .id
            .parse()
            .expect("mock storage must return a parseable UUID");
        (storage, sid)
    }

    #[tokio::test]
    async fn try_pin_session_returns_not_requested_when_input_is_none() {
        let (storage, _sid) = fixture("agent-a").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-a", None).await;
        assert_eq!(outcome, PinnedSessionOutcome::NotRequested);
    }

    #[tokio::test]
    async fn try_pin_session_matches_when_session_belongs_to_agent() {
        let (storage, sid) = fixture("agent-b").await;
        let outcome = try_pin_session(&storage, "jwt", "agent-b", Some(&sid)).await;
        assert_eq!(outcome, PinnedSessionOutcome::Matched(sid));
    }

    #[tokio::test]
    async fn try_pin_session_mismatches_when_session_id_is_unknown() {
        let (storage, _sid) = fixture("agent-c").await;
        // Use a freshly-minted UUID that storage does not know about;
        // the mock will list zero matches and return Mismatch.
        let phantom = SessionId::new();
        let outcome = try_pin_session(&storage, "jwt", "agent-c", Some(&phantom)).await;
        assert_eq!(
            outcome,
            PinnedSessionOutcome::Mismatch {
                session_id: phantom.to_string(),
            }
        );
    }

    #[tokio::test]
    async fn resolve_with_pin_uses_pinned_id_without_round_trip() {
        // When `pinned_session_id` is `Some`, the resolver trusts the
        // upstream `try_pin_session` validation and returns the pin
        // verbatim — even if the agent has other sessions. With the
        // Phase 3 auto-fork hook in place the pinned session is still
        // run through `maybe_auto_fork_chat_session`; the mock storage
        // returns `status="active"` and a 0.0 usage estimate so the
        // fork branch is a no-op and the resolved id matches the pin.
        let (storage, sid) = fixture("agent-d").await;
        let storage_arc = Arc::new(storage);
        let svc = test_session_service(storage_arc.clone());
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: false,
            pinned_session_id: Some(&sid),
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let result = resolve_chat_session_with_pin(
            storage_arc.as_ref(),
            "agent-d",
            "project-x",
            &request,
            &deps,
        )
        .await
        .expect("resolver should yield a session");
        assert_eq!(result.session_id, sid);
        assert!(
            result.fork.is_none(),
            "pinned session below the threshold must not auto-fork"
        );
    }

    #[tokio::test]
    async fn resolve_force_new_overrides_pin() {
        // `force_new=true` (the chat input "+" button) wins over the
        // URL pin: the resolver creates a fresh session even when a
        // pin is supplied. Otherwise the user would land in the old
        // session because their URL still has `?session=`.
        let (storage, sid) = fixture("agent-e").await;
        let storage_arc = Arc::new(storage);
        let svc = test_session_service(storage_arc.clone());
        let request = ChatPersistRequest {
            jwt: "jwt",
            force_new: true,
            pinned_session_id: Some(&sid),
            originating_agent_id: None,
            cross_agent_depth: 0,
            from_agent_id: None,
        };
        let deps = ChatSessionResolveDeps {
            session_service: &svc,
            auto_fork_threshold: 0.8,
        };
        let result = resolve_chat_session_with_pin(
            storage_arc.as_ref(),
            "agent-e",
            "project-x",
            &request,
            &deps,
        )
        .await
        .expect("resolver should create a new session");
        assert_ne!(
            result.session_id, sid,
            "force_new must beat the pin and yield a different session id"
        );
        assert!(
            result.fork.is_none(),
            "force_new without rollover state must not surface a fork event"
        );
    }
}
