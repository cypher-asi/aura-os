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
    /// Session has exited.
    Exit {
        /// Termination code (0 = clean).
        code: i32,
    },
}
