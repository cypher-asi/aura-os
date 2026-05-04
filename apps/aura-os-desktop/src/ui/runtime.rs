//! `tao` event-loop driver: holds the shared state the desktop binary
//! needs to react to webview IPC, IDE-window requests, updater events,
//! and lifecycle changes.
//!
//! All cross-event mutable state lives on [`LoopState`] so the helper
//! functions stay short and respect the project-wide ≤5-parameter rule
//! (the closure captures need to thread the same dozen fields through
//! every handler, which would otherwise blow that limit).

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
use std::time::Duration;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop, EventLoopProxy, EventLoopWindowTarget};
use tao::window::{Fullscreen, WindowId};
use tracing::{info, warn};

use crate::events::{UserEvent, WinCmd};
use crate::frontend::dev_server::stop_managed_frontend_dev_server;
use crate::frontend::routing::apply_restore_route;
use crate::harness::sidecar::stop_managed_local_harness;
use crate::init::env::ci_mode_enabled;
use crate::init::init_script::{build_initialization_script, load_bootstrapped_auth_literals};
use crate::route_state::RouteState;
use crate::ui::icon::IconData;
use crate::ui::main_window::{ipc_handler, open_secondary_main_window};
use crate::updater;

/// Emergency-only rescue timer. The primary trigger to show the window is the
/// IPC `ready` signal from the frontend (scheduled in `main.tsx` after React's
/// first committed paint). The old 3 s value was short enough to routinely
/// race the frontend's first paint and make the webview visible while React
/// was still rendering `null`, which was the root cause of the login-screen
/// flash chased across multiple commits. 15 s only kicks in if the frontend
/// catastrophically fails to signal ready (JS bundle crash, network pipe
/// stall, etc.), in which case showing a blank window is the desired
/// behavior so the user isn't staring at an invisible process.
const WINDOW_SHOW_FALLBACK_DELAY: Duration = Duration::from_secs(15);

/// Inputs the event-loop closure inherits once and never mutates after
/// startup — everything in [`LoopState::handle_*`] reads but does not
/// reassign these.
pub(crate) struct LoopContext {
    pub(crate) icon_data: IconData,
    pub(crate) main_window_id: WindowId,
    pub(crate) proxy: EventLoopProxy<UserEvent>,
    pub(crate) route_state: RouteState,
    pub(crate) host_origin: Option<String>,
    pub(crate) store_path: PathBuf,
}

/// All mutable state held across event-loop iterations. Constructed by
/// `main()` after the webview is up and handed straight into
/// [`run_event_loop`].
pub(crate) struct LoopState {
    pub(crate) main_window: tao::window::Window,
    pub(crate) main_webview: wry::WebView,
    pub(crate) ide_windows: HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    /// Additional main AURA windows spawned via File > New Window. Tracked
    /// separately from `ide_windows` so closing one of them only drops that
    /// window — the primary `main_window` still drives app lifecycle.
    pub(crate) secondary_main_windows: HashMap<WindowId, (tao::window::Window, wry::WebView)>,
    pub(crate) managed_frontend_dev_server: Option<Child>,
    pub(crate) managed_local_harness: Option<Child>,
    pub(crate) frontend_base_url: String,
    pub(crate) using_frontend_dev_server: bool,
    pub(crate) ctx: LoopContext,
}

impl LoopState {
    fn handle_user_event(
        &mut self,
        user_event: UserEvent,
        elwt: &EventLoopWindowTarget<UserEvent>,
        control_flow: &mut ControlFlow,
    ) {
        match user_event {
            UserEvent::WindowCommand { window_id, cmd } => {
                self.handle_window_command(window_id, cmd, control_flow);
            }
            UserEvent::OpenIdeWindow {
                file_path,
                root_path,
            } => {
                self.open_ide_window_with_fallback(elwt, &file_path, root_path.as_deref());
            }
            UserEvent::OpenMainWindow => self.open_secondary_main_window(elwt),
            UserEvent::ShowWindow { window_id } => self.handle_show_window(window_id),
            UserEvent::InstallUpdate { state } => self.handle_install_update(state),
            UserEvent::ShutdownForUpdate => self.handle_shutdown_for_update(control_flow),
            UserEvent::AttachFrontendDevServer { frontend_url } => {
                self.handle_attach_frontend_dev_server(frontend_url);
            }
        }
    }

    fn handle_window_command(
        &mut self,
        window_id: WindowId,
        cmd: WinCmd,
        control_flow: &mut ControlFlow,
    ) {
        if window_id == self.ctx.main_window_id {
            self.handle_main_window_command(cmd, control_flow);
            return;
        }
        if matches!(cmd, WinCmd::Close) {
            self.ide_windows.remove(&window_id);
            self.secondary_main_windows.remove(&window_id);
            return;
        }
        if let Some((win, _)) = self.ide_windows.get(&window_id) {
            apply_secondary_window_command(win, cmd);
            return;
        }
        if let Some((win, _)) = self.secondary_main_windows.get(&window_id) {
            apply_secondary_window_command(win, cmd);
        }
    }

    fn handle_main_window_command(&mut self, cmd: WinCmd, control_flow: &mut ControlFlow) {
        match cmd {
            WinCmd::Minimize => self.main_window.set_minimized(true),
            WinCmd::Maximize => self
                .main_window
                .set_maximized(!self.main_window.is_maximized()),
            WinCmd::Close => {
                stop_managed_frontend_dev_server(&mut self.managed_frontend_dev_server);
                stop_managed_local_harness(&mut self.managed_local_harness);
                *control_flow = ControlFlow::Exit;
            }
            WinCmd::Drag => {
                let _ = self.main_window.drag_window();
            }
            WinCmd::ToggleFullscreen => toggle_fullscreen(&self.main_window),
        }
    }

    fn open_secondary_main_window(&mut self, elwt: &EventLoopWindowTarget<UserEvent>) {
        // Mirror the bootstrap the primary window receives so the new
        // webview shares the user's auth/session state without needing a
        // shared `WebContext`. Loaded fresh from disk so a user who logs
        // in after desktop startup still gets an authenticated extra
        // window.
        let bootstrapped = load_bootstrapped_auth_literals(&self.ctx.store_path);
        let init_script =
            build_initialization_script(self.ctx.host_origin.as_deref(), bootstrapped.as_ref());
        let initial_url = apply_restore_route(
            &self.frontend_base_url,
            self.ctx.route_state.current_route().as_deref(),
        );
        let proxy_clone = self.ctx.proxy.clone();
        match open_secondary_main_window(
            elwt,
            &initial_url,
            &init_script,
            Some(self.ctx.icon_data.to_icon()),
            move |wid| Box::new(ipc_handler(proxy_clone.clone(), wid)),
        ) {
            Ok((win, wv)) => {
                let wid = win.id();
                self.secondary_main_windows.insert(wid, (win, wv));
                spawn_fallback_show_timer(self.ctx.proxy.clone(), wid);
            }
            Err(error) => {
                warn!(%error, "failed to spawn secondary main window");
            }
        }
    }

    fn open_ide_window_with_fallback(
        &mut self,
        elwt: &EventLoopWindowTarget<UserEvent>,
        file_path: &str,
        root_path: Option<&str>,
    ) {
        // Rebuild the same auth/host bootstrap the main webview receives so the IDE
        // webview can talk to the API. The IDE window uses an isolated WebContext,
        // so without this script `window.__AURA_BOOT_AUTH__` and the
        // `aura-jwt` / `aura-session` localStorage mirrors are missing and every
        // request fails the server's auth guard with "missing authorization
        // token". Load fresh literals from disk each time so a user who logs in
        // after desktop startup still gets an authenticated IDE window.
        let bootstrapped = load_bootstrapped_auth_literals(&self.ctx.store_path);
        let init_script =
            build_initialization_script(self.ctx.host_origin.as_deref(), bootstrapped.as_ref());

        let proxy_clone = self.ctx.proxy.clone();
        match aura_os_ide::open_ide_window(
            elwt,
            &self.frontend_base_url,
            file_path,
            root_path,
            Some(self.ctx.icon_data.to_icon()),
            &init_script,
            move |wid| Box::new(ipc_handler(proxy_clone.clone(), wid)),
        ) {
            Ok((win, wv)) => {
                let ide_wid = win.id();
                self.ide_windows.insert(ide_wid, (win, wv));
                spawn_fallback_show_timer(self.ctx.proxy.clone(), ide_wid);
            }
            Err(e) => {
                tracing::error!(error = %e, "failed to open IDE window");
            }
        }
    }

    fn handle_show_window(&mut self, window_id: WindowId) {
        if ci_mode_enabled() {
            return;
        }
        if window_id == self.ctx.main_window_id {
            self.main_window.set_visible(true);
        } else if let Some((ide_win, _)) = self.ide_windows.get(&window_id) {
            ide_win.set_visible(true);
        } else if let Some((win, _)) = self.secondary_main_windows.get(&window_id) {
            win.set_visible(true);
        }
    }

    fn handle_install_update(&mut self, update_state: updater::UpdateState) {
        // Stop the managed sidecar before launching the installer so the
        // update does not have to replace an in-use helper binary.
        stop_managed_local_harness(&mut self.managed_local_harness);
        if let Err(error) = updater::start_install(update_state) {
            warn!(error = %error, "failed to start updater install");
        }
    }

    fn handle_shutdown_for_update(&mut self, control_flow: &mut ControlFlow) {
        info!("updater requested shutdown; stopping sidecars and exiting event loop");
        stop_managed_frontend_dev_server(&mut self.managed_frontend_dev_server);
        stop_managed_local_harness(&mut self.managed_local_harness);
        *control_flow = ControlFlow::Exit;
    }

    fn handle_attach_frontend_dev_server(&mut self, next_frontend_url: String) {
        if self.using_frontend_dev_server || self.frontend_base_url == next_frontend_url {
            return;
        }

        let next_main_url = apply_restore_route(
            &next_frontend_url,
            self.ctx.route_state.current_route().as_deref(),
        );

        info!(
            frontend = %next_main_url,
            "switching main webview to Vite frontend dev server"
        );

        match self.main_webview.load_url(&next_main_url) {
            Ok(()) => {
                self.using_frontend_dev_server = true;
                self.frontend_base_url = next_frontend_url;
            }
            Err(error) => {
                warn!(
                    %error,
                    frontend = %next_main_url,
                    "failed to switch main webview to Vite frontend dev server"
                );
            }
        }
    }

    fn handle_close_requested(&mut self, window_id: WindowId, control_flow: &mut ControlFlow) {
        if window_id == self.ctx.main_window_id {
            stop_managed_frontend_dev_server(&mut self.managed_frontend_dev_server);
            stop_managed_local_harness(&mut self.managed_local_harness);
            *control_flow = ControlFlow::Exit;
        } else {
            self.ide_windows.remove(&window_id);
            self.secondary_main_windows.remove(&window_id);
        }
    }
}

fn apply_secondary_window_command(win: &tao::window::Window, cmd: WinCmd) {
    match cmd {
        WinCmd::Minimize => win.set_minimized(true),
        WinCmd::Maximize => win.set_maximized(!win.is_maximized()),
        WinCmd::Drag => {
            let _ = win.drag_window();
        }
        WinCmd::ToggleFullscreen => toggle_fullscreen(win),
        WinCmd::Close => {}
    }
}

fn toggle_fullscreen(win: &tao::window::Window) {
    if win.fullscreen().is_some() {
        win.set_fullscreen(None);
    } else {
        win.set_fullscreen(Some(Fullscreen::Borderless(None)));
    }
}

pub(crate) fn spawn_fallback_show_timer(proxy: EventLoopProxy<UserEvent>, window_id: WindowId) {
    if ci_mode_enabled() {
        return;
    }
    std::thread::spawn(move || {
        std::thread::sleep(WINDOW_SHOW_FALLBACK_DELAY);
        let _ = proxy.send_event(UserEvent::ShowWindow { window_id });
    });
}

pub(crate) fn run_event_loop(event_loop: EventLoop<UserEvent>, mut state: LoopState) {
    event_loop.run(move |event, elwt, control_flow| {
        *control_flow = ControlFlow::Wait;
        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                window_id,
                ..
            } => state.handle_close_requested(window_id, control_flow),
            Event::UserEvent(user_event) => state.handle_user_event(user_event, elwt, control_flow),
            _ => {}
        }
    });
}
