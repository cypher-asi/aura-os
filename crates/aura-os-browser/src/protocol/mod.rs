//! Wire types shared with the server and the web client.
//!
//! Hot-path frames travel as binary WebSocket messages with a fixed-size
//! little-endian header (see [`frame`]). Control / navigation messages are
//! JSON text (see [`messages`]).

mod frame;
mod messages;

pub use frame::{
    encode_frame_header, parse_frame_header, FrameHeader, FRAME_HEADER_LEN, FRAME_OPCODE,
};
pub use messages::{
    net_error_code, ClientMsg, MouseButton, MouseEventKind, NavError, NavState, ServerEvent,
};
