//! Cross-thread event types shared between the embedded server, the
//! frontend dev-server poller, the updater, and the main `tao` event
//! loop. Kept in a leaf module so every other module can import them
//! without circular dependencies.

use tao::window::{ResizeDirection, WindowId};

use crate::demo::DemoOptions;
use crate::updater::UpdateState;

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NativeNotificationPayload {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default = "default_notification_sound")]
    pub sound: bool,
    #[serde(default)]
    pub badge_count: Option<u32>,
}

fn default_notification_sound() -> bool {
    true
}

#[derive(Debug)]
pub(crate) enum WinCmd {
    Minimize,
    Maximize,
    Close,
    Drag,
    /// Begin a native edge / corner resize on the receiving window.
    /// Driven by the frontend `native-titlebar-resize` JS bridge, which
    /// detects the cursor in a top resize band inside the WebView2 child
    /// (where the OS-level `WM_NCHITTEST` subclass cannot reach) and
    /// IPCs `resize-n` / `resize-ne` / etc. so we can hand off to the
    /// native resize loop via `tao::Window::drag_resize_window`.
    Resize(ResizeDirection),
    /// Toggle borderless fullscreen on the receiving window. Driven by the
    /// View > Toggle Full Screen menu item (and the F11 shortcut) in the
    /// frontend titlebar menu bar.
    ToggleFullscreen,
}

#[derive(Debug)]
pub(crate) enum UserEvent {
    WindowCommand {
        window_id: WindowId,
        cmd: WinCmd,
    },
    OpenIdeWindow {
        file_path: String,
        root_path: Option<String>,
    },
    /// Spawn a brand-new main AURA window — a second tao window plus a
    /// wry webview pointing at the live frontend URL. Driven by the
    /// File > New Window menu item.
    OpenMainWindow,
    ShowWindow {
        window_id: WindowId,
    },
    AttachFrontendDevServer {
        frontend_url: String,
    },
    InstallUpdate {
        state: UpdateState,
    },
    /// Stop managed sidecars and exit the event loop so a pending platform
    /// installer can overwrite this process's files. Posted by the updater
    /// immediately before calling `std::process::exit`.
    ShutdownForUpdate,
    /// Open a dedicated demo window and prepare to record `instruction`
    /// with the validated `options` (window size, target format,
    /// background, full-screen vs framed, and max-duration guard). Posted
    /// by the desktop `POST /api/demo-recordings` route. The window is
    /// driven (and screen-recorded) once the frontend demo bridge in it
    /// signals it is ready (`DemoWindowReady`).
    StartDemoRecording {
        recording_id: String,
        instruction: String,
        options: DemoOptions,
    },
    /// The demo bridge in a demo window finished installing and is ready
    /// to run its instruction. Triggers ffmpeg capture + driving the run.
    DemoWindowReady {
        window_id: WindowId,
    },
    /// The demo bridge finished the instruction's agent turn (or the
    /// recording timed out). Finalizes the recording and closes the window.
    DemoWindowComplete {
        window_id: WindowId,
    },
    /// Show a platform-native desktop notification for the originating
    /// webview window.
    NativeNotification {
        window_id: WindowId,
        payload: NativeNotificationPayload,
    },
}
