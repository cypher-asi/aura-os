//! Best-effort partial JSON extraction helpers.
//!
//! While streaming `input_json_delta` chunks from an LLM, the accumulated
//! buffer is not yet valid JSON — the object may be unterminated and the
//! string value we care about may still be arriving. We can't call
//! `serde_json::from_str` until the whole tool block closes.
//!
//! For specific known top-level string fields (e.g. `title`,
//! `markdown_contents`), we just need to scan for `"key":"..."` and collect
//! the characters arrived so far, respecting JSON escape rules.

/// Extract the current best-effort value of a top-level string field from a
/// partial JSON object buffer.
///
/// Returns `None` if the `"key":"` pattern has not yet appeared. Returns the
/// decoded (unescaped) string value built from the characters seen so far;
/// this may be empty if the opening quote has been emitted but no characters
/// have followed yet.
///
/// Handles standard JSON string escapes: `\n`, `\r`, `\t`, `\"`, `\\`, `\/`,
/// `\b`, `\f`, and `\uXXXX` (basic BMP). If a backslash or `\uXXXX` escape is
/// split across the buffer boundary, the partial escape is dropped from the
/// returned value rather than being mis-decoded; the next call with more
/// bytes will pick it up cleanly.
///
/// This does NOT validate the surrounding JSON structure — it only scans for
/// the key substring. Callers should ensure the `key` name can't realistically
/// collide with a value (e.g. by only using this for well-known tool input
/// keys like `title` and `markdown_contents`).
pub fn extract_partial_string_field(buf: &str, key: &str) -> Option<String> {
    let needle_a = format!("\"{key}\":\"");
    let needle_b = format!("\"{key}\": \"");
    let start = buf
        .find(&needle_a)
        .map(|i| i + needle_a.len())
        .or_else(|| buf.find(&needle_b).map(|i| i + needle_b.len()))?;

    let mut out = String::new();
    let bytes = buf.as_bytes();
    let mut i = start;
    while i < bytes.len() {
        let b = bytes[i];
        if b == b'"' {
            return Some(out);
        }
        if b == b'\\' {
            if i + 1 >= bytes.len() {
                return Some(out);
            }
            let esc = bytes[i + 1];
            match esc {
                b'"' => {
                    out.push('"');
                    i += 2;
                }
                b'\\' => {
                    out.push('\\');
                    i += 2;
                }
                b'/' => {
                    out.push('/');
                    i += 2;
                }
                b'n' => {
                    out.push('\n');
                    i += 2;
                }
                b't' => {
                    out.push('\t');
                    i += 2;
                }
                b'r' => {
                    out.push('\r');
                    i += 2;
                }
                b'b' => {
                    out.push('\u{0008}');
                    i += 2;
                }
                b'f' => {
                    out.push('\u{000C}');
                    i += 2;
                }
                b'u' => {
                    if i + 6 > bytes.len() {
                        return Some(out);
                    }
                    let hex = std::str::from_utf8(&bytes[i + 2..i + 6]).unwrap_or("");
                    if let Ok(code) = u32::from_str_radix(hex, 16) {
                        if let Some(ch) = char::from_u32(code) {
                            out.push(ch);
                            i += 6;
                            continue;
                        }
                    }
                    out.push('\u{FFFD}');
                    i += 6;
                }
                _ => {
                    out.push(esc as char);
                    i += 2;
                }
            }
            continue;
        }
        match std::str::from_utf8(&bytes[i..]) {
            Ok(_) => {
                let ch = buf[i..].chars().next().expect("non-empty suffix");
                out.push(ch);
                i += ch.len_utf8();
            }
            Err(e) => {
                let valid_up_to = e.valid_up_to();
                if valid_up_to == 0 {
                    return Some(out);
                }
                let chunk = &buf[i..i + valid_up_to];
                for ch in chunk.chars() {
                    if ch == '"' {
                        return Some(out);
                    }
                    out.push(ch);
                }
                return Some(out);
            }
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_none_when_key_not_yet_present() {
        assert_eq!(
            extract_partial_string_field("{\"title\":\"foo\"", "markdown_contents"),
            None,
        );
    }

    #[test]
    fn returns_empty_when_key_just_opened() {
        assert_eq!(
            extract_partial_string_field("{\"markdown_contents\":\"", "markdown_contents"),
            Some(String::new()),
        );
    }

    #[test]
    fn collects_in_progress_string_without_closing_quote() {
        assert_eq!(
            extract_partial_string_field(
                "{\"markdown_contents\":\"# Hello",
                "markdown_contents"
            ),
            Some("# Hello".to_string()),
        );
    }

    #[test]
    fn collects_completed_string() {
        assert_eq!(
            extract_partial_string_field(
                "{\"title\":\"Hello World\",\"markdown_contents\":\"body\"",
                "title"
            ),
            Some("Hello World".to_string()),
        );
    }

    #[test]
    fn decodes_newline_escapes() {
        assert_eq!(
            extract_partial_string_field(
                "{\"markdown_contents\":\"# Title\\n\\nPara",
                "markdown_contents"
            ),
            Some("# Title\n\nPara".to_string()),
        );
    }

    #[test]
    fn decodes_quote_and_backslash_escapes() {
        assert_eq!(
            extract_partial_string_field(
                "{\"markdown_contents\":\"a\\\"b\\\\c",
                "markdown_contents"
            ),
            Some("a\"b\\c".to_string()),
        );
    }

    #[test]
    fn decodes_unicode_escape() {
        assert_eq!(
            extract_partial_string_field(
                "{\"markdown_contents\":\"\\u00e9clair",
                "markdown_contents"
            ),
            Some("éclair".to_string()),
        );
    }

    #[test]
    fn drops_trailing_lone_backslash_at_boundary() {
        assert_eq!(
            extract_partial_string_field("{\"markdown_contents\":\"ab\\", "markdown_contents"),
            Some("ab".to_string()),
        );
    }

    #[test]
    fn drops_partial_unicode_escape_at_boundary() {
        assert_eq!(
            extract_partial_string_field(
                "{\"markdown_contents\":\"ab\\u00",
                "markdown_contents"
            ),
            Some("ab".to_string()),
        );
    }

    #[test]
    fn supports_space_between_colon_and_value() {
        assert_eq!(
            extract_partial_string_field("{\"title\": \"Spaced\"", "title"),
            Some("Spaced".to_string()),
        );
    }

    #[test]
    fn grows_monotonically_across_calls() {
        let mut buf = String::from("{\"markdown_contents\":\"");
        assert_eq!(
            extract_partial_string_field(&buf, "markdown_contents"),
            Some(String::new())
        );
        buf.push_str("# H");
        assert_eq!(
            extract_partial_string_field(&buf, "markdown_contents"),
            Some("# H".to_string())
        );
        buf.push_str("ello\\n");
        assert_eq!(
            extract_partial_string_field(&buf, "markdown_contents"),
            Some("# Hello\n".to_string())
        );
        buf.push_str("world\"");
        assert_eq!(
            extract_partial_string_field(&buf, "markdown_contents"),
            Some("# Hello\nworld".to_string())
        );
    }
}
