//! Helpers for the CDP screencast pipeline: viewport metrics, screencast
//! start/stop, and frame-payload decoding.

use base64::Engine;
use chromiumoxide::cdp::browser_protocol::emulation::SetDeviceMetricsOverrideParams;
use chromiumoxide::cdp::browser_protocol::page::{StartScreencastFormat, StartScreencastParams};
use chromiumoxide::Page;

use crate::error::Error;

pub(super) async fn set_viewport(page: &Page, width: u16, height: u16) -> Result<(), Error> {
    let params = SetDeviceMetricsOverrideParams::new(width as i64, height as i64, 1.0, false);
    page.execute(params)
        .await
        .map_err(|e| Error::backend("setDeviceMetricsOverride", e.to_string()))?;
    Ok(())
}

pub(super) async fn start_screencast(
    page: &Page,
    quality: i64,
    width: u16,
    height: u16,
) -> Result<(), Error> {
    let params = StartScreencastParams {
        format: Some(StartScreencastFormat::Jpeg),
        quality: Some(quality),
        max_width: Some(width as i64),
        max_height: Some(height as i64),
        every_nth_frame: Some(1),
    };
    page.execute(params)
        .await
        .map_err(|e| Error::backend("startScreencast", e.to_string()))?;
    Ok(())
}

pub(super) fn decode_screencast_data(data: &chromiumoxide::types::Binary) -> bytes::Bytes {
    // `Binary` serializes as a base64 string on the wire; `AsRef<[u8]>` on
    // the Rust side yields the raw bytes if the library already decoded,
    // else the base64. We try raw first, fall back to base64 decode.
    let raw: &[u8] = data.as_ref();
    if !raw.is_empty() && !raw.iter().all(|b| is_base64_char(*b)) {
        return bytes::Bytes::copy_from_slice(raw);
    }
    match base64::engine::general_purpose::STANDARD.decode(raw) {
        Ok(bytes) => bytes::Bytes::from(bytes),
        Err(_) => bytes::Bytes::copy_from_slice(raw),
    }
}

#[inline]
fn is_base64_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'+' || b == b'/' || b == b'=' || b == b'\n' || b == b'\r'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_base64_char_accepts_expected_set() {
        for b in b'a'..=b'z' {
            assert!(is_base64_char(b));
        }
        for b in b'A'..=b'Z' {
            assert!(is_base64_char(b));
        }
        for b in b'0'..=b'9' {
            assert!(is_base64_char(b));
        }
        for b in [b'+', b'/', b'='] {
            assert!(is_base64_char(b));
        }
        for b in [b'!', b'@', 0x00, 0xFF] {
            assert!(!is_base64_char(b));
        }
    }
}
