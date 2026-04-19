//! Real Chromium/CDP-backed [`BrowserBackend`] implementation.
//!
//! Gated behind the `cdp` cargo feature so the base crate stays lean for
//! environments without a local Chromium/Chrome executable.
//!
//! # Architecture
//!
//! - A single long-lived [`chromiumoxide::Browser`] is launched lazily on
//!   first [`start_session`](BrowserBackend::start_session). All sessions
//!   share the same Chromium process via fresh page targets. When the
//!   last session closes, a grace-period timer optionally shuts Chromium
//!   down so the process footprint follows demand.
//! - Each session owns a per-session command channel and a task that
//!   `select!`s over:
//!   - CDP screencast frames → [`ServerEvent::Frame`]
//!   - CDP navigation events → [`ServerEvent::Nav`]
//!   - our own command channel (dispatch / ack / resize / stop)
//!   - the session cancel token
//! - Frame ack is client-driven: we do *not* ack a CDP frame until the
//!   web client has acked it over the WS. This gives real backpressure
//!   on slow networks so we don't flood the socket.
//! - On session end we fire [`ServerEvent::Exit`] on the events channel
//!   so the WebSocket handler can shut the client cleanly.
//!
//! Failure of a dispatched [`ClientMsg`] is logged but never closes the
//! session; the client can retry. Browser launch errors bubble up.

use std::collections::VecDeque;
use std::env;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use base64::Engine;
use chromiumoxide::cdp::browser_protocol::emulation::SetDeviceMetricsOverrideParams;
use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
    MouseButton as CdpMouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    EnableParams as PageEnableParams, EventFrameNavigated, EventFrameStartedLoading,
    EventFrameStoppedLoading, EventLoadEventFired, EventScreencastFrame, GetNavigationHistoryParams,
    NavigateToHistoryEntryParams, ReloadParams, ScreencastFrameAckParams, StartScreencastFormat,
    StartScreencastParams, StopScreencastParams,
};
use chromiumoxide::{Browser, BrowserConfig as ChromiumBrowserConfig, Page};
use dashmap::DashMap;
use futures_util::StreamExt;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::sleep;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};
use url::Url;

use crate::backend::BrowserBackend;
use crate::config::SpawnOptions;
use crate::error::Error;
use crate::protocol::{ClientMsg, MouseButton, MouseEventKind, NavState, ServerEvent};
use crate::session::SessionId;

const DISPATCH_CHANNEL_CAP: usize = 32;
/// How many un-acked frames a client may have outstanding before the
/// backend stops forwarding new frames and drops the oldest pending CDP
/// ack. Tuned for a snappy feel on LANs while absorbing brief bursts.
const MAX_INFLIGHT_FRAMES: usize = 4;
/// How long to wait after the last session exits before shutting Chromium
/// down. A short grace period avoids restart churn when the user spawns a
/// new session right after closing the last one.
const CHROMIUM_IDLE_GRACE: Duration = Duration::from_secs(15);

/// Runtime configuration for [`CdpBackend`].
///
/// Defaults are sensible: sandbox enabled everywhere the kernel supports
/// it, no proxy, no persistent profile. Override from environment at
/// startup with [`Self::from_env`].
#[derive(Debug, Clone, Default)]
pub struct CdpBackendConfig {
    /// Path to a Chromium/Chrome binary. When `None` chromiumoxide tries
    /// to auto-discover one.
    pub executable_path: Option<PathBuf>,
    /// Persistent profile/user-data directory. When `None` each launch
    /// gets a fresh temp directory.
    pub user_data_dir: Option<PathBuf>,
    /// Outgoing proxy server, e.g. `http://proxy.local:3128`.
    pub proxy_server: Option<String>,
    /// Pass `--no-sandbox` to Chromium. Needed in most container images
    /// but disabled by default so local dev uses the safer sandbox.
    pub disable_sandbox: bool,
    /// How long after the last session exits to wait before shutting
    /// Chromium down. `None` keeps it alive forever (legacy behaviour).
    pub idle_shutdown: Option<Duration>,
}

impl CdpBackendConfig {
    /// Pull configuration from environment variables.
    ///
    /// Recognised keys:
    /// - `BROWSER_EXECUTABLE_PATH` — path to Chromium/Chrome.
    /// - `BROWSER_USER_DATA_DIR` — persistent profile directory.
    /// - `BROWSER_PROXY_SERVER` — proxy server URL.
    /// - `BROWSER_DISABLE_SANDBOX` — `1`/`true` to pass `--no-sandbox`.
    pub fn from_env() -> Self {
        let executable_path = env::var_os("BROWSER_EXECUTABLE_PATH")
            .map(PathBuf::from)
            .or_else(discover_default_browser_executable);
        let user_data_dir = env::var_os("BROWSER_USER_DATA_DIR").map(PathBuf::from);
        let proxy_server = env::var("BROWSER_PROXY_SERVER").ok();
        let disable_sandbox = env::var("BROWSER_DISABLE_SANDBOX")
            .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
            .unwrap_or(false);
        Self {
            executable_path,
            user_data_dir,
            proxy_server,
            disable_sandbox,
            idle_shutdown: Some(CHROMIUM_IDLE_GRACE),
        }
    }
}

fn discover_default_browser_executable() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let roots = [
            env::var_os("ProgramFiles").map(PathBuf::from),
            env::var_os("ProgramFiles(x86)").map(PathBuf::from),
            env::var_os("LocalAppData").map(PathBuf::from),
        ];
        let suffixes: &[&[&str]] = &[
            &["Google", "Chrome", "Application", "chrome.exe"],
            &["Chromium", "Application", "chrome.exe"],
            &["Microsoft", "Edge", "Application", "msedge.exe"],
        ];

        for root in roots.into_iter().flatten() {
            for suffix in suffixes {
                let candidate = suffix
                    .iter()
                    .fold(root.clone(), |path: PathBuf, part| path.join(part));
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    None
}

fn default_profile_dir() -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    env::temp_dir().join(format!("aura-browser-profile-{}-{millis}", std::process::id()))
}

/// Command forwarded from the public trait methods to the per-session task.
enum SessionCommand {
    Client(ClientMsg),
    Ack(u32),
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
    config: CdpBackendConfig,
    launcher: Mutex<Option<Arc<Browser>>>,
    sessions: DashMap<SessionId, SessionState>,
    /// Monotonic generation counter used to cancel stale idle-shutdown
    /// timers when a new session starts during the grace period.
    shutdown_gen: AtomicU64,
}

impl std::fmt::Debug for CdpBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CdpBackend")
            .field("sessions", &self.inner.sessions.len())
            .finish()
    }
}

impl CdpBackend {
    /// Build a `CdpBackend` with default configuration.
    pub fn new() -> Self {
        Self::with_config(CdpBackendConfig::default())
    }

    /// Build a `CdpBackend` with the supplied configuration.
    pub fn with_config(config: CdpBackendConfig) -> Self {
        Self {
            inner: Arc::new(CdpBackendInner {
                config,
                launcher: Mutex::new(None),
                sessions: DashMap::new(),
                shutdown_gen: AtomicU64::new(0),
            }),
        }
    }

    async fn browser(&self) -> Result<Arc<Browser>, Error> {
        let mut guard = self.inner.launcher.lock().await;
        // Bump the generation so any pending idle-shutdown timer aborts.
        self.inner.shutdown_gen.fetch_add(1, Ordering::SeqCst);
        if guard.is_none() {
            let mut builder = ChromiumBrowserConfig::builder();
            if let Some(path) = &self.inner.config.executable_path {
                builder = builder.chrome_executable(path);
            }
            let user_data_dir = self
                .inner
                .config
                .user_data_dir
                .clone()
                .unwrap_or_else(default_profile_dir);
            builder = builder.user_data_dir(&user_data_dir);
            if let Some(proxy) = &self.inner.config.proxy_server {
                builder = builder.arg(format!("--proxy-server={proxy}"));
            }
            if self.inner.config.disable_sandbox {
                builder = builder.no_sandbox();
            }
            let config = builder
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
            info!(profile_dir = %user_data_dir.display(), "headless Chromium launched");
            *guard = Some(Arc::new(browser));
        }
        Ok(Arc::clone(
            guard.as_ref().expect("browser just initialised"),
        ))
    }

    /// Spawn an async task that waits for the idle grace period and, if
    /// no session has appeared in the meantime, shuts the shared browser
    /// down. Called from `stop_session` after removing the session.
    fn schedule_idle_shutdown(&self) {
        let Some(grace) = self.inner.config.idle_shutdown else {
            return;
        };
        if !self.inner.sessions.is_empty() {
            return;
        }
        let inner = Arc::clone(&self.inner);
        let gen = inner.shutdown_gen.fetch_add(1, Ordering::SeqCst) + 1;
        tokio::spawn(async move {
            sleep(grace).await;
            if inner.shutdown_gen.load(Ordering::SeqCst) != gen {
                return;
            }
            if !inner.sessions.is_empty() {
                return;
            }
            let mut guard = inner.launcher.lock().await;
            if let Some(browser_arc) = guard.take() {
                // Best-effort: if other Arcs still live, skip the close so
                // we don't tear the process out from under a pending task.
                match Arc::try_unwrap(browser_arc) {
                    Ok(mut browser) => {
                        if let Err(err) = browser.close().await {
                            debug!(%err, "browser.close failed during idle shutdown");
                        }
                        let _ = browser.wait().await;
                        info!("headless Chromium shut down after idle grace period");
                    }
                    Err(arc) => {
                        // Put it back; a session task is still holding a ref.
                        *guard = Some(arc);
                    }
                }
            }
        });
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

        let task = tokio::spawn(run_session_loop(
            id,
            page,
            events,
            rx,
            cancel,
            quality,
            opts.width,
            opts.height,
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
        self.schedule_idle_shutdown();
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

async fn start_screencast(
    page: &Page,
    quality: i64,
    width: u16,
    height: u16,
) -> Result<(), Error> {
    let params = StartScreencastParams {
        format: Some(StartScreencastFormat::Jpeg),
        quality: Some(quality),
        max_width: Some(width as i64),
        max_height: Some(height as i64),
        every_nth_frame: Some(1),
    };
    page.execute(params)
        .await
        .map_err(|e| Error::backend("startScreencast", e.to_string()))?;
    Ok(())
}

/// Running loading/navigation-history snapshot kept in sync with CDP
/// events so [`build_nav_state`] can serve accurate `NavState`s without a
/// round-trip per event.
#[derive(Debug, Default)]
struct NavTracker {
    loading: bool,
    current_url: String,
    current_title: Option<String>,
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
    mut width: u16,
    mut height: u16,
) {
    if let Err(err) = page.execute(PageEnableParams::default()).await {
        error!(%id, %err, "failed to enable Page domain");
        let _ = events.send(ServerEvent::Exit { code: 1 }).await;
        return;
    }

    if let Err(err) = start_screencast(&page, quality, width, height).await {
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
    let mut started_stream = match page.event_listener::<EventFrameStartedLoading>().await {
        Ok(s) => s,
        Err(err) => {
            warn!(%id, %err, "frameStartedLoading subscribe failed; loading state will be coarse");
            let _ = events.send(ServerEvent::Exit { code: 1 }).await;
            return;
        }
    };
    let mut stopped_stream = match page.event_listener::<EventFrameStoppedLoading>().await {
        Ok(s) => s,
        Err(err) => {
            warn!(%id, %err, "frameStoppedLoading subscribe failed; loading state will be coarse");
            let _ = events.send(ServerEvent::Exit { code: 1 }).await;
            return;
        }
    };

    let mut seq: u32 = 0;
    let mut pending_acks: VecDeque<PendingFrame> = VecDeque::new();
    let mut tracker = NavTracker::default();

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
                        if let ClientMsg::Resize { width: w, height: h } = &msg {
                            width = *w;
                            height = *h;
                        }
                        let was_resize = matches!(msg, ClientMsg::Resize { .. });
                        if let Err(err) = apply_client_msg(&page, msg).await {
                            warn!(%id, %err, "apply_client_msg failed");
                        }
                        if was_resize {
                            // Screencast frames are bound to the CSS size
                            // captured at startScreencast time; restart so
                            // the client receives correctly-sized frames.
                            let _ = page.execute(StopScreencastParams::default()).await;
                            if let Err(err) = start_screencast(&page, quality, width, height).await {
                                warn!(%id, %err, "restartScreencast after resize failed");
                            }
                        }
                    }
                    Some(SessionCommand::Ack(client_seq)) => {
                        drain_acks_up_to(&page, &mut pending_acks, client_seq).await;
                    }
                }
            }
            maybe_frame = frame_stream.next(), if pending_acks.len() < MAX_INFLIGHT_FRAMES => {
                let Some(frame) = maybe_frame else { break };
                let frame = (*frame).clone();
                seq = seq.wrapping_add(1);

                let jpeg = decode_screencast_data(&frame.data);
                let (w, h) = (
                    frame.metadata.device_width.round() as u16,
                    frame.metadata.device_height.round() as u16,
                );
                pending_acks.push_back(PendingFrame {
                    client_seq: seq,
                    cdp_session_id: frame.session_id,
                });
                if events
                    .send(ServerEvent::Frame { seq, width: w, height: h, jpeg })
                    .await
                    .is_err()
                {
                    break;
                }
            }
            maybe_nav = nav_stream.next() => {
                if let Some(nav) = maybe_nav {
                    tracker.current_url = nav.frame.url.clone();
                    let state = build_nav_state(&page, &tracker).await;
                    let _ = events.send(ServerEvent::Nav(state)).await;
                }
            }
            _ = load_stream.next() => {
                tracker.loading = false;
                let state = build_nav_state(&page, &tracker).await;
                let _ = events.send(ServerEvent::Nav(state)).await;
            }
            _ = started_stream.next() => {
                tracker.loading = true;
                let state = build_nav_state(&page, &tracker).await;
                let _ = events.send(ServerEvent::Nav(state)).await;
            }
            _ = stopped_stream.next() => {
                tracker.loading = false;
                let state = build_nav_state(&page, &tracker).await;
                let _ = events.send(ServerEvent::Nav(state)).await;
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

#[derive(Debug)]
struct PendingFrame {
    client_seq: u32,
    cdp_session_id: i64,
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

async fn apply_client_msg(page: &Page, msg: ClientMsg) -> Result<(), Error> {
    match msg {
        ClientMsg::Navigate { url } => {
            page.goto(url.as_str())
                .await
                .map_err(|e| Error::backend("goto", e.to_string()))?;
        }
        ClientMsg::Back => {
            navigate_history_relative(page, -1).await?;
        }
        ClientMsg::Forward => {
            navigate_history_relative(page, 1).await?;
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
            windows_virtual_key_code,
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
                windows_virtual_key_code: windows_virtual_key_code.map(|v| v as i64),
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

async fn navigate_history_relative(page: &Page, offset: i64) -> Result<(), Error> {
    let history = page
        .execute(GetNavigationHistoryParams::default())
        .await
        .map_err(|e| Error::backend("getNavigationHistory", e.to_string()))?;
    let idx = history.result.current_index;
    let target = idx + offset;
    if target < 0 || target >= history.result.entries.len() as i64 {
        // Legitimate no-op: user hit Back at the start of history etc.
        return Ok(());
    }
    let entry_id = history.result.entries[target as usize].id;
    page.execute(NavigateToHistoryEntryParams::new(entry_id))
        .await
        .map_err(|e| Error::backend("navigateToHistoryEntry", e.to_string()))?;
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

    #[test]
    fn config_from_env_respects_booleans() {
        std::env::set_var("BROWSER_DISABLE_SANDBOX", "1");
        let cfg = CdpBackendConfig::from_env();
        assert!(cfg.disable_sandbox);
        std::env::set_var("BROWSER_DISABLE_SANDBOX", "no");
        let cfg = CdpBackendConfig::from_env();
        assert!(!cfg.disable_sandbox);
        std::env::remove_var("BROWSER_DISABLE_SANDBOX");
    }

    #[test]
    fn config_from_env_default_is_safe() {
        env::remove_var("BROWSER_DISABLE_SANDBOX");
        env::remove_var("BROWSER_EXECUTABLE_PATH");
        env::remove_var("BROWSER_USER_DATA_DIR");
        env::remove_var("BROWSER_PROXY_SERVER");
        let cfg = CdpBackendConfig::from_env();
        assert!(!cfg.disable_sandbox);
        assert_eq!(cfg.executable_path, discover_default_browser_executable());
        assert!(cfg.user_data_dir.is_none());
        assert!(cfg.proxy_server.is_none());
        assert_eq!(cfg.idle_shutdown, Some(CHROMIUM_IDLE_GRACE));
    }

    #[test]
    fn config_from_env_prefers_explicit_executable_path() {
        let explicit = std::env::temp_dir().join("aura-browser-explicit.exe");
        env::set_var("BROWSER_EXECUTABLE_PATH", &explicit);
        let cfg = CdpBackendConfig::from_env();
        assert_eq!(cfg.executable_path, Some(explicit));
        env::remove_var("BROWSER_EXECUTABLE_PATH");
    }
}
