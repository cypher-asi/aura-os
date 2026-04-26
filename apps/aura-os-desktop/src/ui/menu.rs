//! Native macOS application menu so AppKit dispatches the standard
//! Cocoa edit shortcuts up to the WebView. No-op on other platforms.

#[cfg(target_os = "macos")]
use tracing::warn;

/// Install a native macOS menu bar so AppKit will dispatch standard
/// edit-shortcut key equivalents (`Cmd+C`/`V`/`X`/`A`/`Z`) up the responder
/// chain to the WebView. Without an `NSMenuItem` bound to those key
/// equivalents AppKit silently swallows the keystrokes, which is why
/// right-click Paste works (the WebView's own context menu calls the
/// Cocoa selectors directly) but keyboard copy/paste does not. The menu
/// items are `muda::PredefinedMenuItem`s that map to the standard Cocoa
/// selectors (`copy:`, `paste:`, `cut:`, `selectAll:`, `undo:`, `redo:`),
/// so the WebView (the first responder) handles them natively.
///
/// No-op on non-macOS targets: WebView2 on Windows and GTK on Linux
/// already handle these shortcuts in input controls without any app menu.
#[cfg(target_os = "macos")]
pub(crate) fn install_macos_app_menu() {
    use muda::{Menu, PredefinedMenuItem, Submenu};

    let menu = Menu::new();

    let app_submenu = Submenu::new("Aura", true);
    if let Err(error) = app_submenu.append_items(&[
        &PredefinedMenuItem::about(Some("Aura"), None),
        &PredefinedMenuItem::separator(),
        &PredefinedMenuItem::hide(None),
        &PredefinedMenuItem::hide_others(None),
        &PredefinedMenuItem::show_all(None),
        &PredefinedMenuItem::separator(),
        &PredefinedMenuItem::quit(None),
    ]) {
        warn!(?error, "failed to populate macOS app submenu");
    }

    let edit_submenu = Submenu::new("Edit", true);
    if let Err(error) = edit_submenu.append_items(&[
        &PredefinedMenuItem::undo(None),
        &PredefinedMenuItem::redo(None),
        &PredefinedMenuItem::separator(),
        &PredefinedMenuItem::cut(None),
        &PredefinedMenuItem::copy(None),
        &PredefinedMenuItem::paste(None),
        &PredefinedMenuItem::select_all(None),
    ]) {
        warn!(?error, "failed to populate macOS edit submenu");
    }

    if let Err(error) = menu.append_items(&[&app_submenu, &edit_submenu]) {
        warn!(?error, "failed to attach submenus to macOS app menu");
        return;
    }

    menu.init_for_nsapp();
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn install_macos_app_menu() {}
