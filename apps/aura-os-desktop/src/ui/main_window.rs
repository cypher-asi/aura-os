//! Main webview window construction: the borderless `tao` window, the
//! `wry` webview that hosts the frontend, and the IPC handler that
//! translates webview messages into `UserEvent`s.

use tao::event_loop::{EventLoopProxy, EventLoopWindowTarget};
use tao::window::{Icon, ResizeDirection, Window, WindowBuilder, WindowId};
use tracing::{debug, info, warn};
use wry::{WebContext, WebView, WebViewBuilder};

use crate::events::{NativeNotificationPayload, UserEvent, WinCmd};
use crate::init::env::ci_mode_enabled;
use crate::ui::chrome::{
    disable_window_background_erase, disable_window_transitions, expand_top_resize_border,
    set_square_corners,
};
use crate::ui::icon::IconData;

const INITIAL_BLANK_PAGE_URL: &str = "about:blank";

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StructuredIpcMessage {
    NativeNotification { payload: NativeNotificationPayload },
}

fn parse_structured_ipc_message(
    message: &str,
) -> Option<Result<StructuredIpcMessage, serde_json::Error>> {
    if !message.starts_with('{') {
        return None;
    }
    Some(serde_json::from_str(message))
}
#[cfg(target_os = "macos")]
fn initial_main_window_visible() -> bool {
    !ci_mode_enabled()
}

#[cfg(not(target_os = "macos"))]
fn initial_main_window_visible() -> bool {
    false
}

/// Forward a webview new-window request to the OS default browser, but only
/// for real external links. Page scripts that call `window.open()` without a
/// URL (e.g. xterm's web-links addon used to) surface here as `about:blank`;
/// handing that to the OS makes Windows show a "Get an app to open this
/// 'about' link" picker dialog. `that_detached` avoids blocking the webview
/// callback thread on platforms where the launcher waits (Linux `xdg-open`).
pub(crate) fn open_external_uri(uri: &str) {
    let lowered = uri.trim().to_ascii_lowercase();
    let allowed = lowered.starts_with("http://")
        || lowered.starts_with("https://")
        || lowered.starts_with("mailto:");
    if !allowed {
        warn!(%uri, "ignoring new-window request with non-external scheme");
        return;
    }
    if let Err(err) = open::that_detached(uri) {
        warn!(%uri, %err, "failed to open external link in OS browser");
    }
}

pub(crate) fn ipc_handler(
    proxy: EventLoopProxy<UserEvent>,
    window_id: WindowId,
) -> impl Fn(wry::http::Request<String>) + 'static {
    move |req: wry::http::Request<String>| {
        let msg = req.body().trim();
        if let Some(parsed) = parse_structured_ipc_message(msg) {
            match parsed {
                Ok(StructuredIpcMessage::NativeNotification { payload }) => {
                    debug!(id = %payload.id, "IPC native notification request");
                    let _ = proxy.send_event(UserEvent::NativeNotification { window_id, payload });
                }
                Err(error) => {
                    warn!(%error, message = msg, "invalid structured IPC message");
                }
            }
            return;
        }
        if matches!(msg, "splash-ready" | "ready") {
            debug!(message = msg, "IPC window reveal signal");
            let _ = proxy.send_event(UserEvent::ShowWindow { window_id });
            return;
        }
        if msg == "app-ready" {
            debug!("IPC app-ready signal");
            return;
        }
        if msg == "new_window" {
            debug!("IPC new_window signal");
            let _ = proxy.send_event(UserEvent::OpenMainWindow);
            return;
        }
        if msg == "demo-ready" {
            debug!("IPC demo-ready signal");
            let _ = proxy.send_event(UserEvent::DemoWindowReady { window_id });
            return;
        }
        if msg == "demo-complete" {
            debug!("IPC demo-complete signal");
            let _ = proxy.send_event(UserEvent::DemoWindowComplete { window_id });
            return;
        }
        let cmd = match msg {
            "minimize" => Some(WinCmd::Minimize),
            "maximize" => Some(WinCmd::Maximize),
            "close" => Some(WinCmd::Close),
            "drag" => Some(WinCmd::Drag),
            "toggle_fullscreen" => Some(WinCmd::ToggleFullscreen),
            // Edge-only resize today; the JS bridge in
            // `interface/src/lib/native-titlebar-resize.ts` only emits
            // `resize-n` for the top edge. Corners and other edges are
            // intentionally not handled yet; if a future iteration adds
            // them, extend the match here (e.g. `"resize-ne" =>
            // ResizeDirection::NorthEast`).
            "resize-n" => Some(WinCmd::Resize(ResizeDirection::North)),
            other => {
                warn!(message = other, "unknown IPC message");
                None
            }
        };
        if let Some(c) = cmd {
            debug!(command = msg, "IPC event");
            let _ = proxy.send_event(UserEvent::WindowCommand { window_id, cmd: c });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_native_notification_ipc_message() {
        let parsed = parse_structured_ipc_message(
            r#"{"type":"native_notification","payload":{"id":"task:1","title":"Task complete","body":"Build finished","sound":false,"badgeCount":2}}"#,
        )
        .expect("structured JSON should be parsed")
        .expect("native notification IPC should deserialize");

        match parsed {
            StructuredIpcMessage::NativeNotification { payload } => {
                assert_eq!(payload.id, "task:1");
                assert_eq!(payload.title, "Task complete");
                assert_eq!(payload.body.as_deref(), Some("Build finished"));
                assert!(!payload.sound);
                assert_eq!(payload.badge_count, Some(2));
            }
        }
    }

    #[test]
    fn ignores_plain_string_ipc_messages() {
        assert!(parse_structured_ipc_message("ready").is_none());
    }
}

pub(crate) fn create_main_window(
    event_loop: &tao::event_loop::EventLoop<UserEvent>,
    icon_data: &IconData,
) -> (tao::window::Window, WindowId) {
    let window = WindowBuilder::new()
        .with_title(aura_os_core::Channel::current().window_title())
        .with_decorations(false)
        .with_visible(initial_main_window_visible())
        .with_window_icon(Some(icon_data.to_icon()))
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0))
        .build(event_loop)
        .expect("failed to build window");

    set_square_corners(&window);
    disable_window_background_erase(&window);
    expand_top_resize_border(&window);

    let id = window.id();
    info!("window created");
    (window, id)
}

pub(crate) fn create_main_webview(
    window: &tao::window::Window,
    web_context: &mut WebContext,
    url: &str,
    initialization_script: &str,
    proxy: EventLoopProxy<UserEvent>,
    main_window_id: WindowId,
) -> wry::WebView {
    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_background_color((0, 0, 0, 255))
        // Start from a fresh blank document before navigating to the real app
        // URL. This prevents WebView2 from briefly painting stale previous-run
        // content (for example a cached `/login` page) while the new navigation
        // is still spinning up. The real app URL is loaded immediately after
        // the webview is built, and the desktop window remains hidden until the
        // frontend posts `ready`, so users only ever see the current session's
        // first committed frame.
        .with_url(INITIAL_BLANK_PAGE_URL)
        .with_initialization_script(initialization_script)
        .with_ipc_handler(ipc_handler(proxy, main_window_id))
        .with_new_window_req_handler(|uri, _features| {
            open_external_uri(&uri);
            wry::NewWindowResponse::Deny
        });

    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(window).expect("failed to build webview");

    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder
            .build_gtk(window.gtk_window())
            .expect("failed to build webview")
    };

    webview
        .load_url(url)
        .expect("failed to load initial main webview url");

    webview
}

/// Spawn an additional standalone main AURA window — a fresh `tao` window
/// plus a `wry::WebView` (sharing the primary window's `WebContext`)
/// pointing at the live frontend URL. Used by the File > New Window menu
/// item; the caller (the event-loop driver in `runtime.rs`) is responsible
/// for keeping the returned tuple alive.
///
/// The shared `WebContext` (web storage / cookies / IndexedDB) means the
/// new window inherits the parent's live auth/session state directly:
/// localStorage already has `aura-jwt` / `aura-session` written by the
/// existing window, so the new webview starts logged-in without any disk
/// round-trip or init-script auth bake-in. Login/logout in any window
/// propagates to the others through the same shared web storage.
pub(crate) fn open_secondary_main_window<E: 'static>(
    event_loop: &EventLoopWindowTarget<E>,
    web_context: &mut WebContext,
    url: &str,
    initialization_script: &str,
    icon: Option<Icon>,
    make_ipc: impl FnOnce(WindowId) -> Box<dyn Fn(wry::http::Request<String>) + 'static>,
) -> Result<(Window, WebView), Box<dyn std::error::Error>> {
    let mut wb = WindowBuilder::new()
        .with_title(aura_os_core::Channel::current().window_title())
        .with_decorations(false)
        .with_visible(false)
        .with_inner_size(tao::dpi::LogicalSize::new(1280.0, 800.0));
    if let Some(ic) = icon {
        wb = wb.with_window_icon(Some(ic));
    }
    let window = wb.build(event_loop)?;
    set_square_corners(&window);
    disable_window_background_erase(&window);
    expand_top_resize_border(&window);

    let ipc = make_ipc(window.id());
    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_background_color((0, 0, 0, 255))
        .with_url(INITIAL_BLANK_PAGE_URL)
        .with_initialization_script(initialization_script)
        .with_ipc_handler(ipc)
        .with_new_window_req_handler(|uri, _features| {
            open_external_uri(&uri);
            wry::NewWindowResponse::Deny
        });

    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window)?;

    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.gtk_window())?
    };

    webview.load_url(url)?;
    info!(%url, "opened secondary main window");
    Ok((window, webview))
}

/// Spawn the dedicated demo-recording window. Like
/// [`open_secondary_main_window`] but with a caller-chosen native title
/// (so ffmpeg can target it uniquely) and inner size. The shared
/// `WebContext` means it inherits the running session's auth, and the
/// per-window `initialization_script` carries the demo marker the
/// frontend bridge reads.
#[allow(clippy::too_many_arguments)]
pub(crate) fn open_demo_window<E: 'static>(
    event_loop: &EventLoopWindowTarget<E>,
    web_context: &mut WebContext,
    url: &str,
    initialization_script: &str,
    icon: Option<Icon>,
    title: &str,
    size: (f64, f64),
    make_ipc: impl FnOnce(WindowId) -> Box<dyn Fn(wry::http::Request<String>) + 'static>,
) -> Result<(Window, WebView), Box<dyn std::error::Error>> {
    let mut wb = WindowBuilder::new()
        .with_title(title)
        .with_decorations(false)
        .with_visible(false)
        .with_inner_size(tao::dpi::LogicalSize::new(size.0, size.1));
    if let Some(ic) = icon {
        wb = wb.with_window_icon(Some(ic));
    }
    let window = wb.build(event_loop)?;
    set_square_corners(&window);
    disable_window_background_erase(&window);
    expand_top_resize_border(&window);
    // The recorder starts gdigrab the moment this window is revealed, so
    // suppress the OS window-appear animation to keep it out of the clip.
    disable_window_transitions(&window);

    let ipc = make_ipc(window.id());
    let builder = WebViewBuilder::new_with_web_context(web_context)
        .with_background_color((0, 0, 0, 255))
        .with_url(INITIAL_BLANK_PAGE_URL)
        .with_initialization_script(initialization_script)
        .with_ipc_handler(ipc)
        .with_new_window_req_handler(|uri, _features| {
            open_external_uri(&uri);
            wry::NewWindowResponse::Deny
        });

    #[cfg(not(target_os = "linux"))]
    let webview = builder.build(&window)?;

    #[cfg(target_os = "linux")]
    let webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        builder.build_gtk(window.gtk_window())?
    };

    webview.load_url(url)?;
    info!(%url, %title, "opened demo recording window");
    Ok((window, webview))
}
