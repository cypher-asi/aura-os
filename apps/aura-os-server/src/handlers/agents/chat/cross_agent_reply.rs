//! Phase 3 of the `send_to_agent` cross-agent reply contract.
//!
//! When agent A messages agent B via the harness `send_to_agent` tool,
//! the harness POST that opens B's chat turn carries
//! `originating_agent_id: <A's id>` (Phase 1, harness commit `6a9b33d`),
//! which `setup.rs` threads onto [`ChatPersistCtx::originating_agent_id`]
//! (Phase 2, server commit `1d01f6e01`). This module is the
//! Phase 3 server-side delivery half: when B's chat turn finishes
//! (`AssistantMessageEnd`), [`spawn_cross_agent_reply_callback`] fires a
//! detached fire-and-forget POST that delivers B's reply as a fresh
//! `user_message` into A's session, so A's LLM sees a new turn and can
//! react instead of having to block on the send-to-agent tool result.
//!
//! ## Cycle protection
//!
//! Two agents can otherwise ping-pong forever once they discover each
//! other's id. We use a belt-and-suspenders pair:
//!
//! 1. **Depth header** — every server-issued reply POST carries
//!    `X-Aura-Cross-Agent-Depth: <n+1>`. The receiving handler reads
//!    the header into [`ChatPersistCtx::cross_agent_depth`] and skips
//!    the callback once the value reaches
//!    [`MAX_CROSS_AGENT_REPLY_DEPTH`].
//!
//! 2. **Single-hop fall-off** — the body's `originating_agent_id` is
//!    serialized as JSON `null` so the receiver of an auto-reply has
//!    no upstream to bounce back to. If the receiving agent's LLM
//!    actually wants to keep the conversation going it has to call
//!    `send_to_agent` again, which re-arms the chain with a fresh
//!    sender id (and starts the depth counter back near zero — by
//!    design; the depth header still travels with that fresh chain).
//!
//! The reply text is truncated at [`MAX_CROSS_AGENT_REPLY_BYTES`]
//! preserving valid UTF-8 boundaries — long replies are pruned with a
//! visible suffix so the recipient agent's LLM doesn't choke on a
//! 200 KiB inbox event.
//!
//! ## Diagnostics
//!
//! All structured logs in this module use
//! `target: "aura::cross_agent"`. The full chain of cross-agent + WS
//! tracing targets, log sites, and the `RUST_LOG` invocation that
//! turns the whole thing on at debug level is documented in
//! [`CROSS_AGENT_TRACING.md`](./CROSS_AGENT_TRACING.md).

use std::time::Duration;

use serde_json::{json, Value};
use tracing::{debug, error, warn};

use super::persist::ChatPersistCtx;

/// Inbound + outbound HTTP header name. Lowercased so [`reqwest`] /
/// axum normalize it consistently — HTTP header names are
/// case-insensitive but we standardize on the canonical lowercase form
/// to avoid two slightly-different match arms in the inbound header
/// reader.
pub(super) const CROSS_AGENT_DEPTH_HEADER: &str = "x-aura-cross-agent-depth";

/// Maximum cross-agent auto-reply hops before the chain dies. Picked
/// at `4` so the most legitimate "two agents collaborating on a
/// hand-off" pattern (A→B reply, B→A reply, A→B reply, terminate)
/// completes naturally while a runaway loop is bounded. Combined with
/// the single-hop fall-off (the body's `originating_agent_id` is
/// nulled on every server-issued reply) the practical depth is
/// usually 1; the counter is the defense-in-depth fence.
pub(super) const MAX_CROSS_AGENT_REPLY_DEPTH: u32 = 4;

/// Hard ceiling on the reply body bytes (UTF-8) the server will deliver
/// into the originating agent's session. Sized to comfortably fit the
/// useful prefix of a long agent reply (~16 KiB ≈ 4 K tokens after
/// tokenisation) without inflating A's context with a 200 KiB
/// blow-by-blow. Replies above this length are truncated with a
/// visible suffix.
pub(super) const MAX_CROSS_AGENT_REPLY_BYTES: usize = 16 * 1024;

/// Suffix appended to a truncated reply so the receiving LLM sees the
/// pruning was server-side and not a model-side stop. Kept in sync with
/// the truncation byte budget — the suffix bytes are accounted for in
/// the cap so the total payload still fits under
/// [`MAX_CROSS_AGENT_REPLY_BYTES`] + suffix length.
pub(super) const TRUNCATION_SUFFIX: &str =
    "\n\n[... truncated to 16 KiB by aura-os-server cross-agent reply ...]";

/// Per-callback HTTP timeout. Cross-agent reply delivery is
/// fire-and-forget, but a slow recipient must not pin a tokio task for
/// minutes — we cap the round-trip generously so a healthy server
/// always wins, but a stuck recipient frees the task instead of
/// queueing more.
const CALLBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Pure predicate. Returns `true` when [`spawn_cross_agent_reply_callback`]
/// should actually issue a reply POST, given the inbound persist
/// context and the current chain depth. Factored out of the spawn so
/// the cycle-guard tests don't need to mount a mock HTTP server.
pub(super) fn should_send_cross_agent_reply(ctx: &ChatPersistCtx, depth: u32) -> bool {
    if ctx.originating_agent_id.is_none() {
        return false;
    }
    if depth >= MAX_CROSS_AGENT_REPLY_DEPTH {
        return false;
    }
    true
}

/// Truncate `text` to at most [`MAX_CROSS_AGENT_REPLY_BYTES`] bytes,
/// preserving UTF-8 char boundaries. Appends [`TRUNCATION_SUFFIX`] when
/// truncation occurred so the recipient LLM can see the cut. Returns
/// the original string verbatim when it fits under the cap (no
/// allocation beyond the input clone).
pub(super) fn truncate_for_cross_agent_reply(text: &str) -> String {
    if text.len() <= MAX_CROSS_AGENT_REPLY_BYTES {
        return text.to_string();
    }
    // `floor_char_boundary` is unstable; iterate `char_indices` to find
    // the largest boundary `<= MAX_CROSS_AGENT_REPLY_BYTES` so the
    // resulting slice is still valid UTF-8 even when the cap lands
    // mid-multi-byte-char.
    let cut = text
        .char_indices()
        .map(|(idx, _)| idx)
        .take_while(|idx| *idx <= MAX_CROSS_AGENT_REPLY_BYTES)
        .last()
        .unwrap_or(0);
    let mut out = String::with_capacity(cut + TRUNCATION_SUFFIX.len());
    out.push_str(&text[..cut]);
    out.push_str(TRUNCATION_SUFFIX);
    out
}

/// Read `X-Aura-Cross-Agent-Depth` off an inbound `HeaderMap` and
/// parse it into a `u32`. Missing / malformed values default to `0`
/// — the header is best-effort cycle-guard plumbing, never
/// load-bearing for the request itself, so an upstream typo or a
/// legacy harness that doesn't set the header just lands at the
/// "fresh chain" depth.
pub(super) fn read_cross_agent_depth(headers: &axum::http::HeaderMap) -> u32 {
    headers
        .get(CROSS_AGENT_DEPTH_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|text| text.trim().parse::<u32>().ok())
        .unwrap_or(0)
}

/// Fire-and-forget cross-agent reply callback. Detaches a tokio task
/// that posts B's reply text into A's session as a `user_message` and
/// returns immediately. Never panics, never retries — the harness can
/// always `send_to_agent` again if it cares.
///
/// `http_client` is reused from the shared `AppState.http_client`
/// (threaded through `ChatPersistTaskExtras.http_client`) so we don't
/// pay TCP/TLS handshake cost per call. `bearer_jwt` is the same JWT
/// the inbound chat turn was authenticated with — propagating it here
/// keeps the callback request authorised under the same identity that
/// owns the originating session.
pub(super) fn spawn_cross_agent_reply_callback(
    ctx: &ChatPersistCtx,
    reply_text: String,
    depth: u32,
    http_client: reqwest::Client,
) {
    if !should_send_cross_agent_reply(ctx, depth) {
        if ctx.originating_agent_id.is_some() && depth >= MAX_CROSS_AGENT_REPLY_DEPTH {
            warn!(
                target: "aura::cross_agent",
                originating_agent_id = ?ctx.originating_agent_id,
                depth,
                max_depth = MAX_CROSS_AGENT_REPLY_DEPTH,
                "cross-agent reply suppressed: depth budget exhausted"
            );
        }
        return;
    }

    // SAFE: `should_send_cross_agent_reply` already ruled `None` out
    // above, but we re-extract here to avoid `&Option` plumbing into
    // the spawned future.
    let originating_agent_id = match ctx.originating_agent_id.as_deref() {
        Some(id) => id.to_string(),
        None => return,
    };

    let truncated = truncate_for_cross_agent_reply(&reply_text);
    let bearer_jwt = ctx.jwt.clone();
    // Stringify the typed `SessionId` at this spawn boundary; the
    // task only ever logs it, and keeping `String` avoids dragging
    // the newtype into the cross-agent reply task signature.
    let session_id = ctx.session_id.to_string();
    let project_agent_id = ctx.project_agent_id.clone();
    let next_depth = depth.saturating_add(1);
    // Display-side provenance: stamp Barret's *org-level* agent id
    // (the same handle A originally addressed via `send_to_agent`)
    // on the outbound POST as `from_agent_id` so when the persist
    // path on A's side writes the resulting `user_message`, the
    // chat panel can label the row "↩ from <Barret>" instead of
    // styling it indistinguishably from a real user prompt
    // — that mislabeling is exactly what made every async reply
    // look like a duplicate of A's original input. We deliberately
    // use `ctx.agent_id` (the org-level handle) rather than
    // `ctx.project_agent_id` (the project binding) because the
    // recipient UI's agent-store is keyed by the org-level id —
    // see `interface/src/apps/agents/stores/agent-store.ts`. When
    // there's no org-level handle (project chats), we fall back
    // to `None`, which keeps the field elided on the wire and
    // renders the row as a regular user prompt — the safe
    // pre-fix behavior.
    let from_agent_id = ctx.agent_id.clone();

    tokio::spawn(async move {
        run_cross_agent_reply_callback(
            http_client,
            originating_agent_id,
            session_id,
            project_agent_id,
            bearer_jwt,
            truncated,
            next_depth,
            from_agent_id,
        )
        .await;
    });
}

#[allow(clippy::too_many_arguments)]
async fn run_cross_agent_reply_callback(
    http_client: reqwest::Client,
    originating_agent_id: String,
    sender_session_id: String,
    sender_project_agent_id: String,
    bearer_jwt: String,
    reply_body: String,
    next_depth: u32,
    from_agent_id: Option<String>,
) {
    let base_url = aura_os_integrations::control_plane_api_base_url();
    if base_url.contains("127.0.0.1") || base_url.contains("localhost") {
        warn!(
            target: "aura::cross_agent",
            base_url = %base_url,
            originating_agent_id = %originating_agent_id,
            "cross-agent reply: using loopback fallback for self-base-url; \
             set AURA_SERVER_BASE_URL or VITE_API_URL when the harness runs off-box"
        );
    }
    let url = format!(
        "{}/api/agents/{}/events/stream",
        base_url, originating_agent_id
    );

    // Same body shape the harness emits in `cross_agent_hook::deliver_message`
    // (action / model / commands / project_id / attachments all `null`,
    // `new_session: false`), but with `originating_agent_id` deliberately
    // serialized as JSON `null` so the receiver of this auto-reply has
    // no upstream to bounce back to. The depth header (next_depth)
    // is the load-bearing cycle guard.
    let body: Value = json!({
        "content": reply_body,
        "action": null,
        "model": null,
        "commands": null,
        "project_id": null,
        "attachments": null,
        "new_session": false,
        "originating_agent_id": null,
        // `from_agent_id` is the *display*-side cross-agent
        // provenance field. Distinct from `originating_agent_id`
        // (which exists for routing the next async reply back, and
        // is intentionally `null` here for the single-hop fall-off
        // — see the cycle protection comment at the top of this
        // module): `from_agent_id` exists so A's chat panel can
        // label the inbound row "↩ from <Barret>" instead of
        // letting the reply masquerade as a duplicate user prompt.
        // `Some(id)` serializes to a string, `None` to JSON null,
        // so the receiver's `parse_user_message_event` can branch
        // on presence vs. value cleanly.
        "from_agent_id": from_agent_id,
    });

    debug!(
        target: "aura::cross_agent",
        originating_agent_id = %originating_agent_id,
        sender_session_id = %sender_session_id,
        sender_project_agent_id = %sender_project_agent_id,
        from_agent_id = ?from_agent_id,
        next_depth,
        url = %url,
        body_bytes = reply_body.len(),
        "posting cross-agent reply callback"
    );

    let response = match http_client
        .post(&url)
        .bearer_auth(&bearer_jwt)
        .header(CROSS_AGENT_DEPTH_HEADER, next_depth.to_string())
        .timeout(CALLBACK_REQUEST_TIMEOUT)
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(error) => {
            error!(
                target: "aura::cross_agent",
                originating_agent_id = %originating_agent_id,
                %error,
                "cross-agent reply callback failed: network error"
            );
            return;
        }
    };

    let status = response.status();
    if !status.is_success() {
        let body_preview = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(400)
            .collect::<String>();
        error!(
            target: "aura::cross_agent",
            originating_agent_id = %originating_agent_id,
            status = %status,
            body = %body_preview,
            "cross-agent reply callback failed"
        );
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn ctx_with_originator(originator: Option<&str>) -> ChatPersistCtx {
        ChatPersistCtx {
            storage: Arc::new(aura_os_storage::StorageClient::with_base_url(
                "http://localhost:9999",
            )),
            session_id: aura_os_core::SessionId::new(),
            project_id: "project-test".to_string(),
            project_agent_id: "00000000-0000-0000-0000-000000000aaa".to_string(),
            agent_id: None,
            originating_agent_id: originator.map(str::to_string),
            cross_agent_depth: 0,
            jwt: "jwt".to_string(),
            from_agent_id: None,
        }
    }

    /// Fold-down regression: feeding a 32 KiB input must produce a
    /// truncated string that (1) stays under
    /// `MAX_CROSS_AGENT_REPLY_BYTES + len(TRUNCATION_SUFFIX)`, (2)
    /// remains valid UTF-8 (no mid-codepoint cut), and (3) ends with
    /// the truncation suffix so the receiving LLM can see the prune.
    /// Pure helper test — no HTTP path involved.
    #[test]
    fn cross_agent_reply_truncates_at_16kib() {
        // 32 KiB of multi-byte-char content. `é` is two UTF-8 bytes,
        // so an odd-byte cap will land mid-codepoint without the
        // boundary scan and tip the result into invalid UTF-8.
        let input = "é".repeat(32 * 1024);
        let out = truncate_for_cross_agent_reply(&input);

        assert!(
            out.len() <= MAX_CROSS_AGENT_REPLY_BYTES + TRUNCATION_SUFFIX.len(),
            "truncated len {} exceeds budget {} + suffix {}",
            out.len(),
            MAX_CROSS_AGENT_REPLY_BYTES,
            TRUNCATION_SUFFIX.len()
        );
        assert!(
            out.ends_with(TRUNCATION_SUFFIX),
            "truncated reply must announce the prune via the suffix"
        );
        assert!(
            std::str::from_utf8(out.as_bytes()).is_ok(),
            "truncation must preserve UTF-8 char boundaries"
        );
    }

    /// Inputs at or below the cap must round-trip verbatim — no
    /// suffix, no allocation surprises. Pins the no-op fast path.
    #[test]
    fn cross_agent_reply_truncate_returns_input_when_under_cap() {
        let input = "small reply".to_string();
        let out = truncate_for_cross_agent_reply(&input);
        assert_eq!(out, input);
        assert!(!out.ends_with(TRUNCATION_SUFFIX));
    }

    /// Cycle-depth guard. With `depth == MAX_CROSS_AGENT_REPLY_DEPTH`
    /// the predicate must short-circuit so the spawn never reaches
    /// the HTTP path, regardless of whether `originating_agent_id` is
    /// set. Tested via the pure predicate so the assertion does not
    /// require a mock axum server (Phase 7 covers the happy-path
    /// integration test).
    #[test]
    fn cross_agent_reply_depth_guard_stops_chain() {
        let ctx = ctx_with_originator(Some("agent-a"));
        assert!(
            !should_send_cross_agent_reply(&ctx, MAX_CROSS_AGENT_REPLY_DEPTH),
            "predicate must refuse to send once depth >= MAX_CROSS_AGENT_REPLY_DEPTH"
        );
        assert!(
            !should_send_cross_agent_reply(&ctx, MAX_CROSS_AGENT_REPLY_DEPTH + 1),
            "predicate must also refuse beyond the cap"
        );
        assert!(
            should_send_cross_agent_reply(&ctx, 0),
            "predicate must accept fresh chains (depth 0) when originator is set"
        );
        assert!(
            should_send_cross_agent_reply(&ctx, MAX_CROSS_AGENT_REPLY_DEPTH - 1),
            "predicate must accept the last legal hop"
        );
    }

    /// Belt-and-suspenders: when no upstream sender is recorded on
    /// the persist context, the predicate must short-circuit
    /// regardless of depth. This is the "user typed in the chat
    /// directly" path — there's no agent A to bounce back into.
    #[test]
    fn cross_agent_reply_noop_when_originating_agent_id_missing() {
        let ctx = ctx_with_originator(None);
        assert!(
            !should_send_cross_agent_reply(&ctx, 0),
            "no originating_agent_id => no auto-reply, no matter the depth"
        );
        assert!(!should_send_cross_agent_reply(&ctx, 1));
    }

    /// Header parser pins: missing / malformed / blank values default
    /// to 0 so a legacy harness or a typo upstream doesn't reject the
    /// request — the depth counter is best-effort cycle plumbing.
    #[test]
    fn read_cross_agent_depth_defaults_to_zero_for_missing_or_malformed() {
        let mut headers = axum::http::HeaderMap::new();
        assert_eq!(read_cross_agent_depth(&headers), 0);

        headers.insert(CROSS_AGENT_DEPTH_HEADER, "abc".parse().unwrap());
        assert_eq!(read_cross_agent_depth(&headers), 0);

        headers.insert(CROSS_AGENT_DEPTH_HEADER, "  ".parse().unwrap());
        assert_eq!(read_cross_agent_depth(&headers), 0);

        headers.insert(CROSS_AGENT_DEPTH_HEADER, "  3  ".parse().unwrap());
        assert_eq!(
            read_cross_agent_depth(&headers),
            3,
            "leading/trailing whitespace must be tolerated"
        );

        headers.insert(CROSS_AGENT_DEPTH_HEADER, "7".parse().unwrap());
        assert_eq!(read_cross_agent_depth(&headers), 7);
    }
}
