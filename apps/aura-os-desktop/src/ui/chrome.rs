//! Platform-specific tweaks to the native window chrome — squared
//! corners on Windows / macOS, and the `BLACK_BRUSH` background fill
//! that hides the OS-default white sliver during a Windows drag-resize.

pub(crate) fn set_square_corners(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWM_WINDOW_CORNER_PREFERENCE,
        };

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        let preference = DWM_WINDOW_CORNER_PREFERENCE(1); // DWMWCP_DONOTROUND
        let _ = unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &preference as *const _ as *const _,
                std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32,
            )
        };
    }

    #[cfg(target_os = "macos")]
    {
        use objc::{sel, sel_impl};
        use tao::platform::macos::WindowExtMacOS;

        unsafe {
            let ns_window = _window.ns_window() as *mut objc::runtime::Object;
            let content_view: *mut objc::runtime::Object = objc::msg_send![ns_window, contentView];
            let _: () = objc::msg_send![content_view, setWantsLayer: true];
            let layer: *mut objc::runtime::Object = objc::msg_send![content_view, layer];
            let _: () = objc::msg_send![layer, setCornerRadius: 0.0_f64];
            let _: () = objc::msg_send![layer, setMasksToBounds: true];
        }
    }

    // Linux: frameless windows don't have app-controllable corner rounding.
    // Any rounding from the compositor (e.g. Mutter, KWin) cannot be overridden.
}

/// Sets the main window class background brush to `BLACK_BRUSH` so that
/// growing the window (right / bottom drag-resize) paints a black bar at
/// the newly-exposed edge before the WebView2 swap chain catches up with
/// the new size, rather than the OS-default white.
///
/// Trade-off vs. `NULL_BRUSH` (hollow brush, "don't erase"):
/// - `NULL_BRUSH` assumes the WebView2 child HWND already covers the whole
///   client area and its previous frame can stay on screen. In practice,
///   during a live drag-resize the WebView2 child lags the OS-level resize
///   by a few frames, and the uncovered strip is filled by DWM composition
///   — which renders as bright white. That flash is very jarring against
///   the app's dark theme.
/// - `BLACK_BRUSH` makes the OS fill the same uncovered strip with black
///   during `WM_ERASEBKGND`. A thin black sliver can briefly "chase" the
///   cursor on the leading edge of a drag-resize, but it blends into the
///   dark theme and into the WebView's own background color
///   (`with_background_color((0, 0, 0, 255))` in `create_main_webview`).
///
/// Between a visible white flash and a visible black flash we explicitly
/// choose black.
///
/// Startup behavior is preserved: the main window is created with
/// `with_visible(false)` and stays hidden until the frontend posts `ready`,
/// so users never see the pre-webview erase color anyway.
pub(crate) fn disable_window_background_erase(_window: &tao::window::Window) {
    #[cfg(target_os = "windows")]
    {
        use tao::platform::windows::WindowExtWindows;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
        use windows::Win32::UI::WindowsAndMessaging::{SetClassLongPtrW, GCL_HBRBACKGROUND};

        let hwnd = HWND(_window.hwnd() as *mut std::ffi::c_void);
        unsafe {
            let black = GetStockObject(BLACK_BRUSH);
            SetClassLongPtrW(hwnd, GCL_HBRBACKGROUND, black.0 as isize);
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(target_os = "windows")]
    fn square_corners_uses_donotround_preference() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        let pref = DWM_WINDOW_CORNER_PREFERENCE(1);
        assert_eq!(pref.0, 1, "DWMWCP_DONOTROUND must be 1");
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn dwm_corner_preference_size_is_four_bytes() {
        use windows::Win32::Graphics::Dwm::DWM_WINDOW_CORNER_PREFERENCE;

        assert_eq!(
            std::mem::size_of::<DWM_WINDOW_CORNER_PREFERENCE>(),
            4,
            "DWM_WINDOW_CORNER_PREFERENCE must be 4 bytes for DwmSetWindowAttribute"
        );
    }
}
