//! Per-session event-pump for the CDP backend.
//!
//! Owns a [`Page`] and the CDP event subscriptions, then translates
//! between CDP streams and our wire-protocol [`ClientMsg`] /
//! [`ServerEvent`] channels:
//!
//! - `Page.screencastFrame` → [`ServerEvent::Frame`]
//! - `Page.frameNavigated` + history → [`ServerEvent::Nav`]
//! - `Page.frameStartedLoading` etc. → [`ServerEvent::Nav { loading }`]
//! - `Network.loadingFailed` (Document) → [`ServerEvent::NavError`]
//! - inbound [`ClientMsg`] → CDP `Input.dispatch*` / `Page.navigate` etc.
//!
//! Frame ack is client-driven for backpressure: a CDP frame is not acked
//! until the client has acked it over WS.
//!
//! Per-event handlers and the mutable state they share live in
//! [`super::handlers`]; this module just orchestrates initialisation,
//! the `tokio::select!` pump, and teardown.

use std::collections::VecDeque;

use chromiumoxide::cdp::browser_protocol::network::{EventLoadingFailed, EventRequestWillBeSent};
use chromiumoxide::cdp::browser_protocol::page::{
    EnableParams as PageEnableParams, EventFrameNavigated, EventFrameStartedLoading,
    EventFrameStoppedLoading, EventLoadEventFired, EventScreencastFrame, StopScreencastParams,
};
use chromiumoxide::listeners::EventStream;
use chromiumoxide::Page;
use futures_util::StreamExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use crate::protocol::ServerEvent;
use crate::session::SessionId;

use super::command::SessionCommand;
use super::handlers::{
    handle_cmd, handle_frame, handle_loading_failed, handle_nav, set_loading,
    update_pending_main_nav, LoopState, NavTracker,
};
use super::screencast::start_screencast;

/// How many un-acked frames a client may have outstanding before the
/// backend stops forwarding new frames and drops the oldest pending CDP
/// ack. Tuned for a snappy feel on LANs while absorbing brief bursts.
const MAX_INFLIGHT_FRAMES: usize = 4;

/// Inputs passed once into [`run_session_loop`]. Bundling keeps the
/// orchestrator under the 5-arg cap.
pub(super) struct SessionLoopCtx {
    pub id: SessionId,
    pub page: Page,
    pub events: mpsc::Sender<ServerEvent>,
    pub commands: mpsc::Receiver<SessionCommand>,
    pub cancel: CancellationToken,
    pub quality: i64,
    pub width: u16,
    pub height: u16,
}

/// Subscribed CDP event streams. Held by [`pump_events`] for the lifetime
/// of the session.
struct SessionStreams {
    frame: EventStream<EventScreencastFrame>,
    nav: EventStream<EventFrameNavigated>,
    load: EventStream<EventLoadEventFired>,
    started: EventStream<EventFrameStartedLoading>,
    stopped: EventStream<EventFrameStoppedLoading>,
    request: EventStream<EventRequestWillBeSent>,
    loading_failed: EventStream<EventLoadingFailed>,
}

/// Inputs to [`init_streams`]. Bundled to keep the param count under 5.
struct InitArgs<'a> {
    page: &'a Page,
    events: &'a mpsc::Sender<ServerEvent>,
    id: SessionId,
    quality: i64,
    width: u16,
    height: u16,
}

/// Subscribe to a CDP event stream or, on failure, log + send `Exit { 1 }`
/// and short-circuit out of [`init_streams`] with `Err(())`.
///
/// Caller picks the log level (`error` or `warn`) and message so we
/// preserve the exact log surface of the legacy single-file backend.
macro_rules! subscribe_or_exit {
    ($page:expr, $events:expr, $id:ident, $type:ty, $logger:ident, $msg:literal) => {{
        let res: Result<EventStream<$type>, ()> = match $page.event_listener::<$type>().await {
            Ok(s) => Ok(s),
            Err(err) => {
                $logger!(%$id, %err, $msg);
                let _ = $events.send(ServerEvent::Exit { code: 1 }).await;
                Err(())
            }
        };
        res
    }};
}

/// Main per-session event pump. Owns the [`Page`] and translates between
/// CDP streams and our [`ServerEvent`] / [`ClientMsg`] channels.
pub(super) async fn run_session_loop(ctx: SessionLoopCtx) {
    let SessionLoopCtx {
        id,
        page,
        events,
        commands,
        cancel,
        quality,
        width,
        height,
    } = ctx;

    let init = InitArgs {
        page: &page,
        events: &events,
        id,
        quality,
        width,
        height,
    };
    let streams = match init_streams(init).await {
        Ok(s) => s,
        Err(()) => return,
    };
    let state = LoopState {
        seq: 0,
        pending_acks: VecDeque::new(),
        tracker: NavTracker::default(),
        pending_main_nav: None,
        width,
        height,
    };

    pump_events(PumpCtx {
        page,
        events,
        id,
        commands,
        cancel,
        streams,
        state,
        quality,
    })
    .await;
}

/// Owned context for [`pump_events`]. Takes ownership of the per-session
/// resources so we can move out of the streams struct (each stream is its
/// own borrow during `tokio::select!`) without fighting the borrow
/// checker.
struct PumpCtx {
    page: Page,
    events: mpsc::Sender<ServerEvent>,
    id: SessionId,
    commands: mpsc::Receiver<SessionCommand>,
    cancel: CancellationToken,
    streams: SessionStreams,
    state: LoopState,
    quality: i64,
}

async fn pump_events(ctx: PumpCtx) {
    let PumpCtx {
        page,
        events,
        id,
        mut commands,
        cancel,
        streams,
        mut state,
        quality,
    } = ctx;

    run_event_loop(
        EventLoopCtx {
            page: &page,
            events: &events,
            id,
            quality,
        },
        &mut state,
        &mut commands,
        &cancel,
        streams,
    )
    .await;

    teardown(page, &events, id).await;
}

/// Borrowed handles needed by [`run_event_loop`]. Bundled to keep the
/// param count under 5.
struct EventLoopCtx<'a> {
    page: &'a Page,
    events: &'a mpsc::Sender<ServerEvent>,
    id: SessionId,
    quality: i64,
}

async fn run_event_loop(
    ctx: EventLoopCtx<'_>,
    state: &mut LoopState,
    commands: &mut mpsc::Receiver<SessionCommand>,
    cancel: &CancellationToken,
    mut streams: SessionStreams,
) {
    let EventLoopCtx {
        page,
        events,
        id,
        quality,
    } = ctx;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                debug!(%id, "cancel token fired; exiting session loop");
                break;
            }
            maybe_cmd = commands.recv() => {
                if !handle_cmd(page, state, maybe_cmd, id, quality).await {
                    break;
                }
            }
            maybe_frame = streams.frame.next(), if state.pending_acks.len() < MAX_INFLIGHT_FRAMES => {
                let Some(f) = maybe_frame else { break };
                if !handle_frame(events, state, f).await {
                    break;
                }
            }
            maybe_nav = streams.nav.next() => {
                handle_nav(page, events, state, maybe_nav).await;
            }
            _ = streams.load.next() => set_loading(page, events, state, false).await,
            _ = streams.started.next() => set_loading(page, events, state, true).await,
            _ = streams.stopped.next() => set_loading(page, events, state, false).await,
            maybe_req = streams.request.next() => {
                if let Some(req) = maybe_req {
                    update_pending_main_nav(&mut state.pending_main_nav, &req);
                }
            }
            maybe_fail = streams.loading_failed.next() => {
                if let Some(fail) = maybe_fail {
                    handle_loading_failed(events, &mut state.pending_main_nav, &fail).await;
                }
            }
        }
    }
}

async fn init_streams(args: InitArgs<'_>) -> Result<SessionStreams, ()> {
    let InitArgs {
        page,
        events,
        id,
        quality,
        width,
        height,
    } = args;

    if let Err(err) = page.execute(PageEnableParams::default()).await {
        error!(%id, %err, "failed to enable Page domain");
        let _ = events.send(ServerEvent::Exit { code: 1 }).await;
        return Err(());
    }
    if let Err(err) = start_screencast(page, quality, width, height).await {
        warn!(%id, %err, "startScreencast failed; continuing without frames");
    }

    subscribe_streams(page, events, id).await
}

/// Subscribe to every CDP event stream the session loop consumes. Each
/// failure logs at the appropriate level, sends [`ServerEvent::Exit`],
/// and short-circuits with `Err(())` (matching the legacy single-file
/// behaviour exactly). `Network.requestWillBeSent` is emitted for every
/// subresource; the main-frame navigation is matched downstream by
/// `type == Document` and `request_id == loader_id`.
#[rustfmt::skip]
async fn subscribe_streams(
    page: &Page,
    events: &mpsc::Sender<ServerEvent>,
    id: SessionId,
) -> Result<SessionStreams, ()> {
    Ok(SessionStreams {
        frame: subscribe_or_exit!(page, events, id, EventScreencastFrame, error, "failed to subscribe to screencastFrame")?,
        nav: subscribe_or_exit!(page, events, id, EventFrameNavigated, warn, "frameNavigated subscribe failed")?,
        load: subscribe_or_exit!(page, events, id, EventLoadEventFired, warn, "loadEventFired subscribe failed")?,
        started: subscribe_or_exit!(page, events, id, EventFrameStartedLoading, warn, "frameStartedLoading subscribe failed; loading state will be coarse")?,
        stopped: subscribe_or_exit!(page, events, id, EventFrameStoppedLoading, warn, "frameStoppedLoading subscribe failed; loading state will be coarse")?,
        request: subscribe_or_exit!(page, events, id, EventRequestWillBeSent, warn, "requestWillBeSent subscribe failed; nav error overlay disabled")?,
        loading_failed: subscribe_or_exit!(page, events, id, EventLoadingFailed, warn, "loadingFailed subscribe failed; nav error overlay disabled")?,
    })
}

async fn teardown(page: Page, events: &mpsc::Sender<ServerEvent>, id: SessionId) {
    if let Err(err) = page.execute(StopScreencastParams::default()).await {
        debug!(%id, %err, "stopScreencast failed on teardown");
    }
    if let Err(err) = page.close().await {
        debug!(%id, %err, "page.close failed on teardown");
    }
    let _ = events.send(ServerEvent::Exit { code: 0 }).await;
    info!(%id, "CDP session loop exited");
}
