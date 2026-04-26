//! Translate [`ClientMsg`] inputs into CDP `Input.dispatchMouseEvent` /
//! `Input.dispatchKeyEvent` / page-navigation calls.

use chromiumoxide::cdp::browser_protocol::input::{
    DispatchKeyEventParams, DispatchKeyEventType, DispatchMouseEventParams, DispatchMouseEventType,
    MouseButton as CdpMouseButton,
};
use chromiumoxide::cdp::browser_protocol::page::{
    GetNavigationHistoryParams, NavigateToHistoryEntryParams, ReloadParams,
};
use chromiumoxide::Page;

use crate::error::Error;
use crate::protocol::{ClientMsg, MouseButton, MouseEventKind};

use super::screencast::set_viewport;

/// Apply one [`ClientMsg`] to `page`. Errors are returned to the caller so
/// the per-session loop can log them; they never tear the session down.
#[rustfmt::skip]
pub(super) async fn apply_client_msg(page: &Page, msg: ClientMsg) -> Result<(), Error> {
    match msg {
        ClientMsg::Navigate { url } => navigate(page, url.as_str()).await,
        ClientMsg::Back => navigate_history_relative(page, -1).await,
        ClientMsg::Forward => navigate_history_relative(page, 1).await,
        ClientMsg::Reload => reload(page).await,
        ClientMsg::Resize { width, height } => set_viewport(page, width, height).await,
        ClientMsg::Mouse { event, x, y, button, modifiers, click_count } =>
            dispatch_mouse(page, MouseInput { event, x, y, button, modifiers, click_count }).await,
        ClientMsg::Wheel { x, y, delta_x, delta_y } => dispatch_wheel(page, x, y, delta_x, delta_y).await,
        ClientMsg::Key { event, key, code, text, modifiers, windows_virtual_key_code } =>
            dispatch_key(page, KeyInput { event, key, code, text, modifiers, windows_virtual_key_code }).await,
    }
}

async fn navigate(page: &Page, url: &str) -> Result<(), Error> {
    page.goto(url)
        .await
        .map_err(|e| Error::backend("goto", e.to_string()))?;
    Ok(())
}

async fn reload(page: &Page) -> Result<(), Error> {
    page.execute(ReloadParams::default())
        .await
        .map_err(|e| Error::backend("reload", e.to_string()))?;
    Ok(())
}

/// Step `offset` entries through the navigation history. A no-op (and
/// silent success) when the requested entry is out of bounds: this is the
/// expected case when the user hits Back at the start of history etc.
pub(super) async fn navigate_history_relative(page: &Page, offset: i64) -> Result<(), Error> {
    let history = page
        .execute(GetNavigationHistoryParams::default())
        .await
        .map_err(|e| Error::backend("getNavigationHistory", e.to_string()))?;
    let idx = history.result.current_index;
    let target = idx + offset;
    if target < 0 || target >= history.result.entries.len() as i64 {
        return Ok(());
    }
    let entry_id = history.result.entries[target as usize].id;
    page.execute(NavigateToHistoryEntryParams::new(entry_id))
        .await
        .map_err(|e| Error::backend("navigateToHistoryEntry", e.to_string()))?;
    Ok(())
}

/// Bundle for [`dispatch_mouse`]. Mirrors the [`ClientMsg::Mouse`] payload
/// so we keep parameter counts under the 5-arg cap.
struct MouseInput {
    event: MouseEventKind,
    x: f32,
    y: f32,
    button: MouseButton,
    modifiers: u32,
    click_count: u32,
}

async fn dispatch_mouse(page: &Page, input: MouseInput) -> Result<(), Error> {
    let params = DispatchMouseEventParams {
        r#type: match input.event {
            MouseEventKind::Move => DispatchMouseEventType::MouseMoved,
            MouseEventKind::Down => DispatchMouseEventType::MousePressed,
            MouseEventKind::Up => DispatchMouseEventType::MouseReleased,
        },
        x: input.x as f64,
        y: input.y as f64,
        modifiers: Some(input.modifiers as i64),
        timestamp: None,
        button: Some(map_mouse_button(input.button)),
        buttons: None,
        click_count: Some(input.click_count as i64),
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
    Ok(())
}

async fn dispatch_wheel(
    page: &Page,
    x: f32,
    y: f32,
    delta_x: f32,
    delta_y: f32,
) -> Result<(), Error> {
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
    Ok(())
}

/// Bundle for [`dispatch_key`]. Mirrors the [`ClientMsg::Key`] payload so
/// we keep parameter counts under the 5-arg cap.
struct KeyInput {
    event: String,
    key: String,
    code: String,
    text: Option<String>,
    modifiers: u32,
    windows_virtual_key_code: Option<u32>,
}

async fn dispatch_key(page: &Page, input: KeyInput) -> Result<(), Error> {
    let ty = if input.event.eq_ignore_ascii_case("down") {
        DispatchKeyEventType::KeyDown
    } else {
        DispatchKeyEventType::KeyUp
    };
    let params = DispatchKeyEventParams {
        r#type: ty,
        modifiers: Some(input.modifiers as i64),
        timestamp: None,
        text: input.text,
        unmodified_text: None,
        key_identifier: None,
        code: Some(input.code),
        key: Some(input.key),
        windows_virtual_key_code: input.windows_virtual_key_code.map(|v| v as i64),
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
}
