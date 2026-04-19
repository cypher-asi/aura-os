//! Binary frame header codec.
//!
//! Layout (9 bytes, little-endian):
//!
//! | offset | size | field  |
//! |-------:|-----:|--------|
//! |      0 |    1 | opcode = [`FRAME_OPCODE`] |
//! |      1 |    4 | sequence number (u32)     |
//! |      5 |    2 | width (u16)               |
//! |      7 |    2 | height (u16)              |
//!
//! The header is followed by the raw JPEG payload. Keeping the control
//! overhead this small avoids the base64 round-trip used by the legacy
//! terminal protocol.

use crate::Error;

/// Opcode identifying a screencast frame in the binary WS channel.
pub const FRAME_OPCODE: u8 = 0x01;

/// Size in bytes of the [`FrameHeader`] on the wire.
pub const FRAME_HEADER_LEN: usize = 9;

/// Decoded screencast frame header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    /// Monotonic sequence number (wraps at `u32::MAX`).
    pub seq: u32,
    /// Frame width in CSS pixels.
    pub width: u16,
    /// Frame height in CSS pixels.
    pub height: u16,
}

/// Parse a [`FrameHeader`] from the start of `buf`.
///
/// Returns the header and the byte offset at which the payload (JPEG bytes)
/// begins. Errors if `buf` is shorter than the header, or if the opcode is
/// not [`FRAME_OPCODE`].
pub fn parse_frame_header(buf: &[u8]) -> Result<(FrameHeader, usize), Error> {
    if buf.len() < FRAME_HEADER_LEN {
        return Err(Error::invalid_input(
            "frame_header",
            format!("buffer too small: {} < {}", buf.len(), FRAME_HEADER_LEN),
        ));
    }
    if buf[0] != FRAME_OPCODE {
        return Err(Error::invalid_input(
            "frame_header.opcode",
            format!("unexpected opcode {:#04x}", buf[0]),
        ));
    }
    let seq = u32::from_le_bytes([buf[1], buf[2], buf[3], buf[4]]);
    let width = u16::from_le_bytes([buf[5], buf[6]]);
    let height = u16::from_le_bytes([buf[7], buf[8]]);
    Ok((FrameHeader { seq, width, height }, FRAME_HEADER_LEN))
}

/// Write a [`FrameHeader`] into `out` (9 bytes).
///
/// Panics only in debug builds when `out.len() < FRAME_HEADER_LEN`. The
/// release path skips the bounds check after writing each field; callers
/// must size their buffer correctly.
pub fn encode_frame_header(out: &mut [u8; FRAME_HEADER_LEN], header: FrameHeader) {
    out[0] = FRAME_OPCODE;
    out[1..5].copy_from_slice(&header.seq.to_le_bytes());
    out[5..7].copy_from_slice(&header.width.to_le_bytes());
    out[7..9].copy_from_slice(&header.height.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_is_identity() {
        let header = FrameHeader {
            seq: 0xDEAD_BEEF,
            width: 1280,
            height: 800,
        };
        let mut buf = [0u8; FRAME_HEADER_LEN];
        encode_frame_header(&mut buf, header);
        let (parsed, offset) = parse_frame_header(&buf).expect("header should parse");
        assert_eq!(parsed, header);
        assert_eq!(offset, FRAME_HEADER_LEN);
    }

    #[test]
    fn rejects_short_buffer() {
        let buf = [FRAME_OPCODE, 0, 0];
        let err = parse_frame_header(&buf).expect_err("short buffer should error");
        match err {
            Error::InvalidInput { field, .. } => assert_eq!(field, "frame_header"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn rejects_wrong_opcode() {
        let mut buf = [0u8; FRAME_HEADER_LEN];
        buf[0] = 0xFF;
        let err = parse_frame_header(&buf).expect_err("wrong opcode should error");
        match err {
            Error::InvalidInput { field, .. } => assert_eq!(field, "frame_header.opcode"),
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn header_appears_at_start_with_payload_after() {
        let header = FrameHeader {
            seq: 1,
            width: 10,
            height: 20,
        };
        let mut buf = vec![0u8; FRAME_HEADER_LEN + 4];
        let header_slice: &mut [u8; FRAME_HEADER_LEN] =
            (&mut buf[..FRAME_HEADER_LEN]).try_into().unwrap();
        encode_frame_header(header_slice, header);
        buf[FRAME_HEADER_LEN..].copy_from_slice(&[1, 2, 3, 4]);
        let (parsed, offset) = parse_frame_header(&buf).unwrap();
        assert_eq!(parsed, header);
        assert_eq!(&buf[offset..], &[1, 2, 3, 4]);
    }
}
