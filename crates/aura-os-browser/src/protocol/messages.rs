//! Control-channel JSON messages.
//!
//! These travel on `Message::Text` WebSocket frames. Sizes are small and
//! the hot-path (screencast) uses [`super::frame`] instead.

use serde::{Deserialize, Serialize};
use url::Url;

/// Messages sent from the web client to the server.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum ClientMsg {
    /// Navigate the current page to `url`.
    Navigate {
        /// Absolute `http(s)` URL to navigate to.
        url: Url,
    },
    /// Go back one entry in the history stack.
    Back,
    /// Go forward one entry in the history stack.
    Forward,
    /// Reload the current page.
    Reload,
    /// Resize the viewport.
    Resize {
        /// New viewport width in CSS pixels.
        width: u16,
        /// New viewport height in CSS pixels.
        height: u16,
    },
    /// Forward a mouse event.
    Mouse {
        /// The kind of mouse event.
        event: MouseEventKind,
        /// X in viewport CSS pixels.
        x: f32,
        /// Y in viewport CSS pixels.
        y: f32,
        /// Which button is involved (for down / up).
        #[serde(default)]
        button: MouseButton,
        /// Modifier-key mask (see CDP `Input.dispatchMouseEvent.modifiers`).
        #[serde(default)]
        modifiers: u32,
        /// Click count for `Down` events.
        #[serde(default)]
        click_count: u32,
    },
    /// Forward a key event.
    Key {
        /// `"down"` or `"up"`.
        event: String,
        /// DOM `KeyboardEvent.key`.
        key: String,
        /// DOM `KeyboardEvent.code`.
        code: String,
        /// Typed characters, if any.
        #[serde(default)]
        text: Option<String>,
        /// CDP modifier mask.
        #[serde(default)]
        modifiers: u32,
        /// Windows virtual-key code (CDP's `windowsVirtualKeyCode`). When
        /// absent the backend falls back to `key` / `code`.
        #[serde(default)]
        windows_virtual_key_code: Option<u32>,
    },
    /// Forward a wheel event (coalesced on the client before sending).
    Wheel {
        /// X in viewport CSS pixels.
        x: f32,
        /// Y in viewport CSS pixels.
        y: f32,
        /// Horizontal scroll delta.
        delta_x: f32,
        /// Vertical scroll delta.
        delta_y: f32,
    },
}

/// Which mouse button was used for a Mouse message.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    /// Primary (usually left) button.
    #[default]
    Left,
    /// Middle button.
    Middle,
    /// Secondary (usually right) button.
    Right,
    /// No button (e.g. plain `move`).
    None,
}

/// Which kind of mouse event fired.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MouseEventKind {
    /// Pointer moved without changing button state.
    Move,
    /// Mouse button pressed.
    Down,
    /// Mouse button released.
    Up,
}

/// Server → client navigation update.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavState {
    /// Current fully-resolved URL of the primary frame.
    pub url: String,
    /// Current document title, when known.
    pub title: Option<String>,
    /// Whether a back navigation is possible.
    pub can_go_back: bool,
    /// Whether a forward navigation is possible.
    pub can_go_forward: bool,
    /// Whether the main resource is still loading.
    pub loading: bool,
}

/// Server → client main-frame navigation failure.
///
/// Emitted when loading the main document of a page fails (DNS resolution
/// error, TCP/TLS failure, aborted load, …). The client uses this to
/// render an in-app error overlay instead of Chromium's default error
/// page, so the look and feel matches the rest of Aura.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NavError {
    /// URL the browser was trying to reach when the load failed.
    pub url: String,
    /// Human-readable short error description, typically the Chromium
    /// `net::ERR_*` code (for example `net::ERR_NAME_NOT_RESOLVED`).
    pub error_text: String,
    /// Chromium `net_error` numeric code when known (e.g. `-105` for
    /// `ERR_NAME_NOT_RESOLVED`). Optional because not every failure
    /// carries a well-known numeric mapping.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<i32>,
}

/// Events pushed from the server to the client.
///
/// `Frame` events travel as binary WS messages and are modelled here only
/// for internal channel typing. The wire format for Frame is the binary
/// header + payload in [`super::frame`]; this enum is never serialized for
/// the Frame arm on the WS text channel.
#[derive(Debug, Clone)]
pub enum ServerEvent {
    /// A screencast frame is available for delivery.
    Frame {
        /// Monotonic frame sequence.
        seq: u32,
        /// Frame width.
        width: u16,
        /// Frame height.
        height: u16,
        /// JPEG-encoded pixel data.
        jpeg: bytes::Bytes,
    },
    /// Navigation state updated.
    Nav(NavState),
    /// Main-frame navigation failed.
    NavError(NavError),
    /// Session has exited.
    Exit {
        /// Termination code (0 = clean).
        code: i32,
    },
}

/// Map a Chromium `net::ERR_*` string to its numeric `net_error` value.
///
/// The full table lives in Chromium's `net/base/net_error_list.h`; only
/// the codes most users will recognise (DNS, network, TLS, …) are listed
/// here. Unknown codes return `None` and are still surfaced to the client
/// via [`NavError::error_text`].
pub fn net_error_code(error_text: &str) -> Option<i32> {
    // Strip the leading "net::" if present; some event payloads ship the
    // bare "ERR_*" string.
    let key = error_text.strip_prefix("net::").unwrap_or(error_text);
    Some(match key {
        "ERR_ABORTED" => -3,
        "ERR_ACCESS_DENIED" => -10,
        "ERR_TIMED_OUT" => -7,
        "ERR_FAILED" => -2,
        "ERR_CONNECTION_CLOSED" => -100,
        "ERR_CONNECTION_RESET" => -101,
        "ERR_CONNECTION_REFUSED" => -102,
        "ERR_CONNECTION_ABORTED" => -103,
        "ERR_CONNECTION_FAILED" => -104,
        "ERR_NAME_NOT_RESOLVED" => -105,
        "ERR_INTERNET_DISCONNECTED" => -106,
        "ERR_ADDRESS_UNREACHABLE" => -109,
        "ERR_ADDRESS_INVALID" => -108,
        "ERR_CONNECTION_TIMED_OUT" => -118,
        "ERR_NAME_RESOLUTION_FAILED" => -137,
        "ERR_NETWORK_CHANGED" => -21,
        "ERR_BLOCKED_BY_CLIENT" => -20,
        "ERR_BLOCKED_BY_RESPONSE" => -27,
        "ERR_CERT_COMMON_NAME_INVALID" => -200,
        "ERR_CERT_DATE_INVALID" => -201,
        "ERR_CERT_AUTHORITY_INVALID" => -202,
        "ERR_CERT_INVALID" => -207,
        "ERR_CERT_REVOKED" => -206,
        "ERR_SSL_PROTOCOL_ERROR" => -107,
        "ERR_TOO_MANY_REDIRECTS" => -310,
        "ERR_EMPTY_RESPONSE" => -324,
        "ERR_HTTP_RESPONSE_CODE_FAILURE" => -379,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nav_error_numeric_codes_match_chromium() {
        assert_eq!(net_error_code("net::ERR_NAME_NOT_RESOLVED"), Some(-105));
        assert_eq!(net_error_code("ERR_CONNECTION_REFUSED"), Some(-102));
        assert_eq!(net_error_code("ERR_CERT_AUTHORITY_INVALID"), Some(-202));
        assert_eq!(net_error_code("ERR_NOT_A_REAL_ERROR"), None);
    }

    #[test]
    fn nav_error_round_trips_without_code() {
        let err = NavError {
            url: "http://example.invalid/".into(),
            error_text: "net::ERR_NAME_NOT_RESOLVED".into(),
            code: None,
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(!json.contains("code"));
        let back: NavError = serde_json::from_str(&json).unwrap();
        assert_eq!(back, err);
    }

    #[test]
    fn nav_error_round_trips_with_code() {
        let err = NavError {
            url: "http://example.invalid/".into(),
            error_text: "net::ERR_NAME_NOT_RESOLVED".into(),
            code: Some(-105),
        };
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"code\":-105"));
        let back: NavError = serde_json::from_str(&json).unwrap();
        assert_eq!(back, err);
    }
}
