//! Real Chromium/CDP-backed [`BrowserBackend`] implementation.
//!
//! Gated behind the `cdp` cargo feature so the base crate stays lean for
//! environments without a local Chromium/Chrome executable.
//!
//! # Architecture
//!
//! - A single long-lived [`chromiumoxide::Browser`] is launched lazily on
//!   first [`start_session`](BrowserBackend::start_session). All sessions
//!   share the same Chromium process via fresh page targets.
//! - Each session owns a per-session command channel and a task that
//!   `select!`s over:
//!   - CDP screencast frames → [`ServerEvent::Frame`]
//!   - CDP `frameNavigated` / `loadEventFired` events → [`ServerEvent::Nav`]
//!   - our own command channel (dispatch / ack / resize / …)
//!   - the session cancel token
//! - On session end we fire [`ServerEvent::Exit`] on the events channel so
//!   the WebSocket handler can shut the client cleanly.
//!
//! Failure of the CDP command from a dispatched [`ClientMsg`] is logged
//! but never closes the session; the client can retry. Browser launch
//! errors bubble up so the manager can fall back to [`crate::StubBackend`].

use std::sync::Arc;

use async_trait::async_trait;
use base64::Engine;
use chromiumoxide::cdp::browser_protocol::emulation::SetDeviceMetricsOverrideParams;
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
    MouseButton as CdpMouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    EventFrameNavigated, EventLoadEventFired, EventScreencastFrame, ReloadParams,
    ScreencastFrameAckParams, StartScreencastFormat, StartScreencastParams, StopScreencastParams,
};
use chromiumoxide::{Browser, BrowserConfig as ChromiumBrowserConfig, Page};
use dashmap::DashMap;
use futures_util::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};
use url::Url;

use crate::backend::BrowserBackend;
use crate::config::SpawnOptions;
use crate::error::Error;
use crate::protocol::{ClientMsg, MouseButton, MouseEventKind, NavState, ServerEvent};
use crate::session::SessionId;

const DISPATCH_CHANNEL_CAP: usize = 32;

/// Command forwarded from the public trait methods to the per-session task.
enum SessionCommand {
    Client(ClientMsg),
    /// Client ack of a frame sequence. CDP ack is sent at send-time so this
    /// is purely advisory today; we keep it so flow-control can be added
    /// without a trait change.
    Ack(#[allow(dead_code)] u32),
    Stop,
}

struct SessionState {
    tx: mpsc::Sender<SessionCommand>,
    task: JoinHandle<()>,
}

/// CDP-backed [`BrowserBackend`]. Cheap to `Arc`; clone to share across
/// the `BrowserManager` and the session tasks.
pub struct CdpBackend {
    inner: Arc<CdpBackendInner>,
}

struct CdpBackendInner {
    launcher: Mutex<Option<Arc<Browser>>>,
    sessions: DashMap<SessionId, SessionState>,
}

impl std::fmt::Debug for CdpBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CdpBackend")
            .field("sessions", &self.inner.sessions.len())
            .finish()
    }
}

impl CdpBackend {
    /// Build an empty `CdpBackend`. Chromium is launched lazily on the
    /// first `start_session` call so the server boots even when Chrome is
    /// absent; if the launch fails, the error is surfaced there.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(CdpBackendInner {
                launcher: Mutex::new(None),
                sessions: DashMap::new(),
            }),
        }
    }

    async fn browser(&self) -> Result<Arc<Browser>, Error> {
        let mut guard = self.inner.launcher.lock().await;
        if guard.is_none() {
            let config = ChromiumBrowserConfig::builder()
                .no_sandbox()
                .build()
                .map_err(|e| Error::backend("chromium_config", e.to_string()))?;
            let (browser, mut handler) = Browser::launch(config)
                .await
                .map_err(|e| Error::backend("chromium_launch", e.to_string()))?;
            tokio::spawn(async move {
                while let Some(event) = handler.next().await {
                    if let Err(err) = event {
                        warn!(%err, "chromium handler error");
                    }
                }
            });
            info!("headless Chromium launched");
            *guard = Some(Arc::new(browser));
        }
        Ok(Arc::clone(
            guard.as_ref().expect("browser just initialised"),
        ))
    }
}

impl Default for CdpBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl Clone for CdpBackend {
    fn clone(&self) -> Self {
        Self {
            inner: Arc::clone(&self.inner),
        }
    }
}

#[async_trait]
impl BrowserBackend for CdpBackend {
    async fn start_session(
        &self,
        id: SessionId,
        opts: SpawnOptions,
        initial_url: Option<Url>,
        events: mpsc::Sender<ServerEvent>,
        cancel: CancellationToken,
    ) -> Result<(), Error> {
        let browser = self.browser().await?;
        let url = initial_url
            .as_ref()
            .map(|u| u.to_string())
            .unwrap_or_else(|| "about:blank".to_string());

        let page = browser
            .new_page(url.as_str())
            .await
            .map_err(|e| Error::backend("new_page", e.to_string()))?;

        set_viewport(&page, opts.width, opts.height).await?;

        let (tx, rx) = mpsc::channel(DISPATCH_CHANNEL_CAP);
        let quality = opts.frame_quality.unwrap_or(75) as i64;
        let max_w = opts.width as i64;
        let max_h = opts.height as i64;

        let task = tokio::spawn(run_session_loop(
            id, page, events, rx, cancel, quality, max_w, max_h,
        ));

        self.inner.sessions.insert(id, SessionState { tx, task });
        Ok(())
    }

    async fn dispatch(&self, id: SessionId, msg: ClientMsg) -> Result<(), Error> {
        let Some(state) = self.inner.sessions.get(&id) else {
            return Err(Error::SessionNotFound(id.to_string()));
        };
        state
            .tx
            .send(SessionCommand::Client(msg))
            .await
            .map_err(|_| Error::backend("dispatch", "session task gone"))
    }

    async fn ack_frame(&self, id: SessionId, seq: u32) -> Result<(), Error> {
        let Some(state) = self.inner.sessions.get(&id) else {
            return Ok(());
        };
        let _ = state.tx.send(SessionCommand::Ack(seq)).await;
        Ok(())
    }

    async fn stop_session(&self, id: SessionId) -> Result<(), Error> {
        if let Some((_, state)) = self.inner.sessions.remove(&id) {
            let _ = state.tx.send(SessionCommand::Stop).await;
            if let Err(err) = state.task.await {
                debug!(%id, ?err, "session task join failed");
            }
        }
        Ok(())
    }
}

async fn set_viewport(page: &Page, width: u16, height: u16) -> Result<(), Error> {
    let params = SetDeviceMetricsOverrideParams::new(width as i64, height as i64, 1.0, false);
    page.execute(params)
        .await
        .map_err(|e| Error::backend("setDeviceMetricsOverride", e.to_string()))?;
    Ok(())
}

/// Main per-session event pump. Owns the [`Page`] and translates between
/// CDP streams and our [`ServerEvent`] / [`ClientMsg`] channels.
#[allow(clippy::too_many_arguments)]
async fn run_session_loop(
    id: SessionId,
    page: Page,
    events: mpsc::Sender<ServerEvent>,
    mut commands: mpsc::Receiver<SessionCommand>,
    cancel: CancellationToken,
    quality: i64,
    max_w: i64,
    max_h: i64,
) {
    let screencast = StartScreencastParams {
        format: Some(StartScreencastFormat::Jpeg),
        quality: Some(quality),
        max_width: Some(max_w),
        max_height: Some(max_h),
        every_nth_frame: Some(1),
    };
    if let Err(err) = page.execute(screencast).await {
        warn!(%id, %err, "startScreencast failed; continuing without frames");
    }

    let mut frame_stream = match page.event_listener::<EventScreencastFrame>().await {
        Ok(s) => s,
        Err(err) => {
            error!(%id, %err, "failed to subscribe to screencastFrame");
            let _ = events.send(ServerEvent::Exit { code: 1 }).await;
            return;
        }
    };
    let mut nav_stream = match page.event_listener::<EventFrameNavigated>().await {
        Ok(s) => s,
        Err(err) => {
            warn!(%id, %err, "frameNavigated subscribe failed");
            let _ = events.send(ServerEvent::Exit { code: 1 }).await;
            return;
        }
    };
    let mut load_stream = match page.event_listener::<EventLoadEventFired>().await {
        Ok(s) => s,
        Err(err) => {
            warn!(%id, %err, "loadEventFired subscribe failed");
            let _ = events.send(ServerEvent::Exit { code: 1 }).await;
            return;
        }
    };

    let mut seq: u32 = 0;

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                debug!(%id, "cancel token fired; exiting session loop");
                break;
            }
            maybe_cmd = commands.recv() => {
                match maybe_cmd {
                    Some(SessionCommand::Stop) | None => break,
                    Some(SessionCommand::Client(msg)) => {
                        if let Err(err) = apply_client_msg(&page, msg).await {
                            warn!(%id, %err, "apply_client_msg failed");
                        }
                    }
                    Some(SessionCommand::Ack(_)) => {
                        // Ack is handled per-frame via CDP immediately after
                        // we send the frame to the client; we do not need
                        // the client's explicit ack to unblock CDP.
                    }
                }
            }
            maybe_frame = frame_stream.next() => {
                let Some(frame) = maybe_frame else { break };
                let frame = (*frame).clone();
                seq = seq.wrapping_add(1);

                if let Err(err) = page
                    .execute(ScreencastFrameAckParams::new(frame.session_id))
                    .await
                {
                    debug!(%id, %err, "screencastFrameAck failed");
                }

                let jpeg = decode_screencast_data(&frame.data);
                let (width, height) = (
                    frame.metadata.device_width.round() as u16,
                    frame.metadata.device_height.round() as u16,
                );
                if events
                    .send(ServerEvent::Frame { seq, width, height, jpeg })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            maybe_nav = nav_stream.next() => {
                if let Some(nav) = maybe_nav {
                    let nav_state = build_nav_state(&page, Some(&nav.frame.url)).await;
                    let _ = events.send(ServerEvent::Nav(nav_state)).await;
                }
            }
            _ = load_stream.next() => {
                let nav_state = build_nav_state(&page, None).await;
                let _ = events.send(ServerEvent::Nav(nav_state)).await;
            }
        }
    }

    if let Err(err) = page.execute(StopScreencastParams::default()).await {
        debug!(%id, %err, "stopScreencast failed on teardown");
    }
    if let Err(err) = page.close().await {
        debug!(%id, %err, "page.close failed on teardown");
    }
    let _ = events.send(ServerEvent::Exit { code: 0 }).await;
    info!(%id, "CDP session loop exited");
}

fn decode_screencast_data(data: &chromiumoxide::types::Binary) -> bytes::Bytes {
    // `Binary` serializes as a base64 string on the wire; `AsRef<[u8]>` on
    // the Rust side yields the raw bytes if the library already decoded,
    // else the base64. We try raw first, fall back to base64 decode.
    let raw: &[u8] = data.as_ref();
    if !raw.is_empty() && !raw.iter().all(|b| is_base64_char(*b)) {
        return bytes::Bytes::copy_from_slice(raw);
    }
    match base64::engine::general_purpose::STANDARD.decode(raw) {
        Ok(bytes) => bytes::Bytes::from(bytes),
        Err(_) => bytes::Bytes::copy_from_slice(raw),
    }
}

#[inline]
fn is_base64_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=' || b == b'\n' || b == b'\r'
}

async fn build_nav_state(page: &Page, url_hint: Option<&str>) -> NavState {
    let url = match url_hint {
        Some(u) => u.to_string(),
        None => page.url().await.ok().flatten().unwrap_or_default(),
    };
    let title = page.get_title().await.ok().flatten();
    // chromiumoxide doesn't expose history length trivially; leave these
    // conservative. The client can still wire back/forward buttons and the
    // CDP call will simply no-op if there is nothing to navigate to.
    NavState {
        url,
        title,
        can_go_back: true,
        can_go_forward: true,
        loading: false,
    }
}

async fn apply_client_msg(page: &Page, msg: ClientMsg) -> Result<(), Error> {
    match msg {
        ClientMsg::Navigate { url } => {
            page.goto(url.as_str())
                .await
                .map_err(|e| Error::backend("goto", e.to_string()))?;
        }
        ClientMsg::Back => {
            let _ = page
                .evaluate("history.back()")
                .await
                .map_err(|e| Error::backend("history.back", e.to_string()))?;
        }
        ClientMsg::Forward => {
            let _ = page
                .evaluate("history.forward()")
                .await
                .map_err(|e| Error::backend("history.forward", e.to_string()))?;
        }
        ClientMsg::Reload => {
            page.execute(ReloadParams::default())
                .await
                .map_err(|e| Error::backend("reload", e.to_string()))?;
        }
        ClientMsg::Resize { width, height } => {
            set_viewport(page, width, height).await?;
        }
        ClientMsg::Mouse {
            event,
            x,
            y,
            button,
            modifiers,
            click_count,
        } => {
            let params = DispatchMouseEventParams {
                r#type: match event {
                    MouseEventKind::Move => DispatchMouseEventType::MouseMoved,
                    MouseEventKind::Down => DispatchMouseEventType::MousePressed,
                    MouseEventKind::Up => DispatchMouseEventType::MouseReleased,
                },
                x: x as f64,
                y: y as f64,
                modifiers: Some(modifiers as i64),
                timestamp: None,
                button: Some(map_mouse_button(button)),
                buttons: None,
                click_count: Some(click_count as i64),
                force: None,
                tangential_pressure: None,
                tilt_x: None,
                tilt_y: None,
                twist: None,
                delta_x: None,
                delta_y: None,
                pointer_type: None,
            };
            page.execute(params)
                .await
                .map_err(|e| Error::backend("dispatchMouseEvent", e.to_string()))?;
        }
        ClientMsg::Wheel {
            x,
            y,
            delta_x,
            delta_y,
        } => {
            let params = DispatchMouseEventParams {
                r#type: DispatchMouseEventType::MouseWheel,
                x: x as f64,
                y: y as f64,
                modifiers: Some(0),
                timestamp: None,
                button: Some(CdpMouseButton::None),
                buttons: None,
                click_count: None,
                force: None,
                tangential_pressure: None,
                tilt_x: None,
                tilt_y: None,
                twist: None,
                delta_x: Some(delta_x as f64),
                delta_y: Some(delta_y as f64),
                pointer_type: None,
            };
            page.execute(params)
                .await
                .map_err(|e| Error::backend("dispatchMouseEvent.wheel", e.to_string()))?;
        }
        ClientMsg::Key {
            event,
            key,
            code,
            text,
            modifiers,
        } => {
            let ty = if event.eq_ignore_ascii_case("down") {
                DispatchKeyEventType::KeyDown
            } else {
                DispatchKeyEventType::KeyUp
            };
            let params = DispatchKeyEventParams {
                r#type: ty,
                modifiers: Some(modifiers as i64),
                timestamp: None,
                text,
                unmodified_text: None,
                key_identifier: None,
                code: Some(code),
                key: Some(key),
                windows_virtual_key_code: None,
                native_virtual_key_code: None,
                auto_repeat: None,
                is_keypad: None,
                is_system_key: None,
                location: None,
                commands: None,
            };
            page.execute(params)
                .await
                .map_err(|e| Error::backend("dispatchKeyEvent", e.to_string()))?;
        }
    }
    Ok(())
}

fn map_mouse_button(btn: MouseButton) -> CdpMouseButton {
    match btn {
        MouseButton::Left => CdpMouseButton::Left,
        MouseButton::Middle => CdpMouseButton::Middle,
        MouseButton::Right => CdpMouseButton::Right,
        MouseButton::None => CdpMouseButton::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mouse_button_maps_all_variants() {
        assert!(matches!(
            map_mouse_button(MouseButton::Left),
            CdpMouseButton::Left
        ));
        assert!(matches!(
            map_mouse_button(MouseButton::Middle),
            CdpMouseButton::Middle
        ));
        assert!(matches!(
            map_mouse_button(MouseButton::Right),
            CdpMouseButton::Right
        ));
        assert!(matches!(
            map_mouse_button(MouseButton::None),
            CdpMouseButton::None
        ));
    }

    #[test]
    fn is_base64_char_accepts_expected_set() {
        for b in b'a'..=b'z' {
            assert!(is_base64_char(b));
        }
        for b in b'A'..=b'Z' {
            assert!(is_base64_char(b));
        }
        for b in b'0'..=b'9' {
            assert!(is_base64_char(b));
        }
        for b in [b'+', b'/', b'='] {
            assert!(is_base64_char(b));
        }
        for b in [b'!', b'@', 0x00, 0xFF] {
            assert!(!is_base64_char(b));
        }
    }
}
