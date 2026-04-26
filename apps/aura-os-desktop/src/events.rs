//! Cross-thread event types shared between the embedded server, the
//! frontend dev-server poller, the updater, and the main `tao` event
//! loop. Kept in a leaf module so every other module can import them
//! without circular dependencies.

use tao::window::WindowId;

use crate::updater::UpdateState;

#[derive(Debug)]
pub(crate) enum WinCmd {
    Minimize,
    Maximize,
    Close,
    Drag,
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
}
