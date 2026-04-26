//! Per-event handlers and the mutable state they share.
//!
//! Split out of [`super::session_loop`] so the orchestration there stays
//! under the 500-line cap. Each handler is a small async fn called from
//! one arm of the `tokio::select!` in [`super::session_loop::pump_events`].

use std::collections::VecDeque;
use std::sync::Arc;

use chromiumoxide::cdp::browser_protocol::network::{
    EventLoadingFailed, EventRequestWillBeSent, ResourceType,
};
use chromiumoxide::cdp::browser_protocol::page::{
    EventFrameNavigated, EventScreencastFrame, GetNavigationHistoryParams,
    ScreencastFrameAckParams, StopScreencastParams,
};
use chromiumoxide::Page;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use crate::protocol::{net_error_code, ClientMsg, NavError, NavState, ServerEvent};
use crate::session::SessionId;

use super::command::SessionCommand;
use super::input::apply_client_msg;
use super::screencast::{decode_screencast_data, start_screencast};

/// Mutable state owned by [`super::session_loop::pump_events`] and
/// threaded through the per-event handlers below.
pub(super) struct LoopState {
    pub(super) seq: u32,
    pub(super) pending_acks: VecDeque<PendingFrame>,
    pub(super) tracker: NavTracker,
    /// Last main-frame document request we've seen. When `loadingFailed`
    /// fires for this request we turn it into a [`NavError`] so the
    /// client can render its in-app overlay.
    pub(super) pending_main_nav: Option<PendingMainNav>,
    pub(super) width: u16,
    pub(super) height: u16,
}

/// Running loading/navigation-history snapshot kept in sync with CDP
/// events so [`build_nav_state`] can serve accurate [`NavState`]s without
/// a round-trip per event.
#[derive(Debug, Default)]
pub(super) struct NavTracker {
    loading: bool,
    current_url: String,
    current_title: Option<String>,
}

#[derive(Debug)]
pub(super) struct PendingFrame {
    client_seq: u32,
    cdp_session_id: i64,
}

/// The most recent main-frame document request we've observed on the
/// CDP Network domain. We only keep one at a time: Chromium cancels the
/// previous main-frame request whenever a new one starts, so the older
/// entry is never the one that'll end up in [`EventLoadingFailed`].
#[derive(Debug, Clone)]
pub(super) struct PendingMainNav {
    request_id: String,
    url: String,
}

/// Handle one [`SessionCommand`]. Returns `false` when the loop should
/// break (Stop / closed channel).
pub(super) async fn handle_cmd(
    page: &Page,
    state: &mut LoopState,
    cmd: Option<SessionCommand>,
    id: SessionId,
    quality: i64,
) -> bool {
    match cmd {
        Some(SessionCommand::Stop) | None => false,
        Some(SessionCommand::Client(msg)) => {
            apply_and_maybe_restart(page, state, msg, id, quality).await;
            true
        }
        Some(SessionCommand::Ack(client_seq)) => {
            drain_acks_up_to(page, &mut state.pending_acks, client_seq).await;
            true
        }
    }
}

/// Apply a [`ClientMsg`] and, if it was a `Resize`, restart the screencast
/// so the client receives correctly-sized frames.
async fn apply_and_maybe_restart(
    page: &Page,
    state: &mut LoopState,
    msg: ClientMsg,
    id: SessionId,
    quality: i64,
) {
    if let ClientMsg::Resize { width, height } = &msg {
        state.width = *width;
        state.height = *height;
    }
    let was_resize = matches!(msg, ClientMsg::Resize { .. });
    if let Err(err) = apply_client_msg(page, msg).await {
        warn!(%id, %err, "apply_client_msg failed");
    }
    if was_resize {
        // Screencast frames are bound to the CSS size captured at
        // startScreencast time; restart so the client receives
        // correctly-sized frames.
        let _ = page.execute(StopScreencastParams::default()).await;
        if let Err(err) = start_screencast(page, quality, state.width, state.height).await {
            warn!(%id, %err, "restartScreencast after resize failed");
        }
    }
}

/// Forward a screencast frame to the client. Returns `false` if the
/// events channel is closed and the loop should break.
pub(super) async fn handle_frame(
    events: &mpsc::Sender<ServerEvent>,
    state: &mut LoopState,
    frame: Arc<EventScreencastFrame>,
) -> bool {
    state.seq = state.seq.wrapping_add(1);
    let seq = state.seq;
    let jpeg = decode_screencast_data(&frame.data);
    let w = frame.metadata.device_width.round() as u16;
    let h = frame.metadata.device_height.round() as u16;
    state.pending_acks.push_back(PendingFrame {
        client_seq: seq,
        cdp_session_id: frame.session_id,
    });
    events
        .send(ServerEvent::Frame {
            seq,
            width: w,
            height: h,
            jpeg,
        })
        .await
        .is_ok()
}

pub(super) async fn handle_nav(
    page: &Page,
    events: &mpsc::Sender<ServerEvent>,
    state: &mut LoopState,
    maybe_nav: Option<Arc<EventFrameNavigated>>,
) {
    let Some(nav) = maybe_nav else {
        return;
    };
    state.tracker.current_url = nav.frame.url.clone();
    let st = build_nav_state(page, &state.tracker).await;
    let _ = events.send(ServerEvent::Nav(st)).await;
}

pub(super) async fn set_loading(
    page: &Page,
    events: &mpsc::Sender<ServerEvent>,
    state: &mut LoopState,
    loading: bool,
) {
    state.tracker.loading = loading;
    let st = build_nav_state(page, &state.tracker).await;
    let _ = events.send(ServerEvent::Nav(st)).await;
}

pub(super) fn update_pending_main_nav(
    pending: &mut Option<PendingMainNav>,
    req: &EventRequestWillBeSent,
) {
    if is_main_frame_navigation(req) {
        *pending = Some(PendingMainNav {
            request_id: req.request_id.inner().clone(),
            url: req.request.url.clone(),
        });
    }
}

pub(super) async fn handle_loading_failed(
    events: &mpsc::Sender<ServerEvent>,
    pending_main_nav: &mut Option<PendingMainNav>,
    fail: &EventLoadingFailed,
) {
    let failed_id = fail.request_id.inner().as_str();
    let matched = pending_main_nav
        .as_ref()
        .map(|p| p.request_id.as_str() == failed_id)
        .unwrap_or(false);
    if !matched {
        return;
    }
    let Some(pending) = pending_main_nav.take() else {
        return;
    };
    // Only surface Document failures as nav errors; subresource failures
    // are expected and should not hide the page.
    let is_document = matches!(fail.r#type, ResourceType::Document);
    // Treat user-cancelled navigations (e.g. the user typed a new URL
    // while one was in flight) as a no-op; Chromium marks these with
    // `canceled`.
    let canceled = fail.canceled.unwrap_or(false);
    if is_document && !canceled {
        let code = net_error_code(&fail.error_text);
        let _ = events
            .send(ServerEvent::NavError(NavError {
                url: pending.url.clone(),
                error_text: fail.error_text.clone(),
                code,
            }))
            .await;
    }
}

/// Identify a `Network.requestWillBeSent` event as a top-level navigation.
///
/// Chromium marks main-document navigations by making `request_id` and
/// `loader_id` equal and setting the resource type to `Document`. Iframe
/// navigations fail this check because they have a distinct `loader_id`.
fn is_main_frame_navigation(event: &EventRequestWillBeSent) -> bool {
    let is_document = event
        .r#type
        .as_ref()
        .map(|t| matches!(t, ResourceType::Document))
        .unwrap_or(false);
    is_document && event.request_id.inner() == event.loader_id.inner()
}

async fn drain_acks_up_to(page: &Page, queue: &mut VecDeque<PendingFrame>, client_seq: u32) {
    while let Some(front) = queue.front() {
        if front.client_seq > client_seq {
            break;
        }
        let cdp_id = front.cdp_session_id;
        queue.pop_front();
        if let Err(err) = page.execute(ScreencastFrameAckParams::new(cdp_id)).await {
            debug!(%err, "screencastFrameAck failed");
        }
    }
}

async fn build_nav_state(page: &Page, tracker: &NavTracker) -> NavState {
    let history = page
        .execute(GetNavigationHistoryParams::default())
        .await
        .ok()
        .map(|resp| resp.result.clone());

    let (can_go_back, can_go_forward) = match &history {
        Some(h) => {
            let idx = h.current_index;
            let len = h.entries.len() as i64;
            (idx > 0, idx + 1 < len)
        }
        None => (false, false),
    };

    let url = if tracker.current_url.is_empty() {
        page.url().await.ok().flatten().unwrap_or_default()
    } else {
        tracker.current_url.clone()
    };
    let title = match &tracker.current_title {
        Some(t) => Some(t.clone()),
        None => page.get_title().await.ok().flatten(),
    };

    NavState {
        url,
        title,
        can_go_back,
        can_go_forward,
        loading: tracker.loading,
    }
}
