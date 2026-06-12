use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::connector::ChatConnector;
use crate::error::ChannelError;
use crate::inbound::{build_inbound, InboundHandler};
use crate::kind::ChannelKind;

/// Telegram's hard cap on a single `sendMessage` text body, in characters.
const TELEGRAM_MESSAGE_LIMIT: usize = 4096;

/// Long-poll `timeout` (seconds) passed to `getUpdates`.
const LONG_POLL_TIMEOUT_SECS: u64 = 30;

/// Per-request reqwest timeout — comfortably above the long-poll timeout.
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// Back-off applied after a failed poll so a flapping network can't spin the
/// loop.
const POLL_BACKOFF: Duration = Duration::from_secs(3);

/// A [`ChatConnector`] over the Telegram Bot API.
///
/// Outbound calls hit `sendMessage` / `sendChatAction`; the inbound loop uses
/// `getUpdates` long-polling. The `base_url` is overridable so tests can point
/// at a mock server.
pub struct TelegramConnector {
    token: String,
    http: reqwest::Client,
    base_url: String,
    offset: AtomicI64,
}

impl TelegramConnector {
    /// Construct a connector from a bot token, using Telegram's public API
    /// base url and a default HTTP client.
    pub fn new(token: String) -> Self {
        Self::with_base_url(token, "https://api.telegram.org".to_string())
    }

    /// Construct a connector against a custom `base_url` (for tests).
    pub fn with_base_url(token: String, base_url: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
            .build()
            .unwrap_or_default();
        Self {
            token,
            http,
            base_url: base_url.trim_end_matches('/').to_string(),
            offset: AtomicI64::new(0),
        }
    }

    /// Convenience async constructor mirroring other transports' `connect`.
    pub async fn connect(token: String) -> Result<Self, ChannelError> {
        Ok(Self::new(token))
    }

    fn method_url(&self, method: &str) -> String {
        format!("{}/bot{}/{}", self.base_url, self.token, method)
    }

    /// Resolve the bot's `@username` via `getMe`. Used by linking flows that
    /// build `t.me/<username>?start=<code>` deep links.
    pub async fn fetch_bot_username(&self) -> Result<String, ChannelError> {
        let url = self.method_url("getMe");
        let resp = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        let body: Value = resp
            .json()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        body.get("result")
            .and_then(|r| r.get("username"))
            .and_then(|u| u.as_str())
            .map(|s| s.to_string())
            .ok_or(ChannelError::NotFound)
    }

    /// POST a single `sendMessage` chunk, optionally with a `parse_mode`.
    async fn post_message(
        &self,
        url: &str,
        chat_ref: &str,
        text: &str,
        parse_mode: Option<&str>,
    ) -> Result<(), ChannelError> {
        let mut body = json!({ "chat_id": chat_ref, "text": text });
        if let Some(mode) = parse_mode {
            body["parse_mode"] = json!(mode);
        }
        let resp = self
            .http
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(ChannelError::Transport(format!(
                "sendMessage failed ({status}): {body}"
            )));
        }
        Ok(())
    }
}

/// Split `text` into chunks no longer than `limit` characters.
///
/// Prefers to break on a newline boundary within the window; only hard-splits
/// (mid-line) when a single line exceeds `limit`. Pure and side-effect free so
/// the chunking rule is unit-testable. Returns a single empty chunk for empty
/// input so callers always send at least one message.
pub fn split_message(text: &str, limit: usize) -> Vec<String> {
    debug_assert!(limit > 0, "limit must be positive");
    if text.is_empty() {
        return vec![String::new()];
    }

    let chars: Vec<char> = text.chars().collect();
    let mut chunks = Vec::new();
    let mut start = 0;

    while start < chars.len() {
        let remaining = chars.len() - start;
        if remaining <= limit {
            chunks.push(chars[start..].iter().collect());
            break;
        }

        // Window we could emit this round: [start, start + limit).
        let window_end = start + limit;
        // Prefer the last newline strictly inside the window so the next chunk
        // begins after it.
        let split_at = chars[start..window_end]
            .iter()
            .rposition(|&c| c == '\n')
            .map(|rel| start + rel)
            .filter(|&nl| nl > start);

        match split_at {
            Some(nl) => {
                // Include up to (but not including) the newline; skip it.
                chunks.push(chars[start..nl].iter().collect());
                start = nl + 1;
            }
            None => {
                // No usable newline — hard split at the limit.
                chunks.push(chars[start..window_end].iter().collect());
                start = window_end;
            }
        }
    }

    chunks
}

/// Convert lightweight Markdown into clean plain text for a chat client.
///
/// Agent replies are authored in Markdown, but the Telegram bot sends messages
/// without a `parse_mode`, so markers like `**bold**`, `*italic*`, `# Heading`,
/// `` `code` `` and `[label](url)` would otherwise show up verbatim. This strips
/// the formatting markers while preserving the underlying content so the text
/// reads naturally in a regular chat bubble. Pure and side-effect free so the
/// rules stay unit-testable.
pub fn strip_markdown(text: &str) -> String {
    let mut out_lines = Vec::new();
    let mut in_fence = false;

    for raw_line in text.split('\n') {
        let trimmed = raw_line.trim_start();

        // Fenced code blocks: drop the ``` / ~~~ fence lines, keep the body
        // verbatim (no inline stripping inside code).
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            out_lines.push(raw_line.to_string());
            continue;
        }

        // Horizontal rules (---, ***, ___) collapse to a blank line.
        let t = raw_line.trim();
        if t.len() >= 3
            && (t.chars().all(|c| c == '-')
                || t.chars().all(|c| c == '*')
                || t.chars().all(|c| c == '_'))
        {
            out_lines.push(String::new());
            continue;
        }

        let line = strip_block_prefix(raw_line);
        out_lines.push(strip_inline(&line));
    }

    out_lines.join("\n")
}

/// Strip line-level markers: headings, blockquotes, and bullet markers.
fn strip_block_prefix(line: &str) -> String {
    let indent_len = line
        .char_indices()
        .find(|(_, c)| *c != ' ' && *c != '\t')
        .map(|(i, _)| i)
        .unwrap_or(line.len());
    let (indent, mut rest) = line.split_at(indent_len);

    // Blockquote markers (one level).
    if let Some(after) = rest.strip_prefix("> ") {
        rest = after;
    } else if let Some(after) = rest.strip_prefix('>') {
        rest = after;
    }

    // ATX headings: 1-6 leading '#', followed by a space (or end of line).
    if rest.starts_with('#') {
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if hashes <= 6 {
            let after = &rest[hashes..];
            if after.is_empty() || after.starts_with(' ') {
                return format!("{indent}{}", after.trim_start());
            }
        }
    }

    // Unordered list markers become a bullet glyph.
    for marker in ["- ", "* ", "+ "] {
        if let Some(after) = rest.strip_prefix(marker) {
            return format!("{indent}\u{2022} {after}");
        }
    }

    format!("{indent}{rest}")
}

/// Strip inline markers (emphasis, code spans, links) from a single line.
fn strip_inline(line: &str) -> String {
    let chars: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];
        match c {
            // Backslash escape: emit the escaped char literally.
            '\\' if i + 1 < chars.len() => {
                out.push(chars[i + 1]);
                i += 2;
            }
            // Inline code span: keep the contents, drop the backticks.
            '`' => {
                if let Some(rel) = chars[i + 1..].iter().position(|&x| x == '`') {
                    let end = i + 1 + rel;
                    out.extend(&chars[i + 1..end]);
                    i = end + 1;
                } else {
                    i += 1;
                }
            }
            // Image: ![alt](url) -> alt (url).
            '!' if chars.get(i + 1) == Some(&'[') => {
                if let Some((text, url, end)) = parse_link(&chars, i + 1) {
                    push_link(&mut out, &text, &url);
                    i = end;
                } else {
                    out.push('!');
                    i += 1;
                }
            }
            // Link: [text](url) -> text (url).
            '[' => {
                if let Some((text, url, end)) = parse_link(&chars, i) {
                    push_link(&mut out, &text, &url);
                    i = end;
                } else {
                    out.push('[');
                    i += 1;
                }
            }
            // Bold/italic with asterisks: drop the run of '*'.
            '*' => {
                while i < chars.len() && chars[i] == '*' {
                    i += 1;
                }
            }
            // Strikethrough.
            '~' if chars.get(i + 1) == Some(&'~') => {
                i += 2;
            }
            // Bold with double underscore. Single '_' is left intact so
            // snake_case identifiers survive.
            '_' if chars.get(i + 1) == Some(&'_') => {
                i += 2;
            }
            _ => {
                out.push(c);
                i += 1;
            }
        }
    }

    out
}

/// Parse a Markdown link starting at the `[` located at `open`.
///
/// Returns `(text, url, end)` where `end` is the index just past the closing
/// `)`. Returns `None` when the text isn't a well-formed `[..](..)` link.
fn parse_link(chars: &[char], open: usize) -> Option<(String, String, usize)> {
    let text_end = chars[open + 1..].iter().position(|&c| c == ']')? + open + 1;
    if chars.get(text_end + 1) != Some(&'(') {
        return None;
    }
    let url_start = text_end + 2;
    let url_end = chars[url_start..].iter().position(|&c| c == ')')? + url_start;
    let text: String = chars[open + 1..text_end].iter().collect();
    let url: String = chars[url_start..url_end].iter().collect();
    Some((text, url, url_end + 1))
}

/// Render a parsed link as plain text, dropping the URL when it adds nothing.
fn push_link(out: &mut String, text: &str, url: &str) {
    let text = strip_inline(text.trim());
    let url = url.trim();
    if text.is_empty() {
        out.push_str(url);
    } else if url.is_empty() || text == url {
        out.push_str(&text);
    } else {
        out.push_str(&text);
        out.push_str(" (");
        out.push_str(url);
        out.push(')');
    }
}

/// Convert the agent's CommonMark into Telegram's MarkdownV2 dialect.
///
/// The agent authors standard CommonMark (`**bold**`, `*italic*`, `# Heading`,
/// `[label](url)`, fenced code), but Telegram's MarkdownV2 uses a different
/// dialect (`*bold*`, `_italic_`, no headings) and requires every literal
/// special character to be backslash-escaped. This translates the markers and
/// escapes everything else so styling renders natively. Pure and side-effect
/// free so the rules stay unit-testable.
pub fn to_markdown_v2(text: &str) -> String {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out_lines = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let trimmed = lines[i].trim_start();

        // Fenced code blocks are emitted as a single MarkdownV2 pre-block, with
        // the body escaped for `` ` `` and `\` only.
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            let fence = &trimmed[..3];
            let lang: String = trimmed[3..]
                .chars()
                .take_while(|c| c.is_alphanumeric())
                .collect();
            let mut body = Vec::new();
            i += 1;
            while i < lines.len() {
                if lines[i].trim_start().starts_with(fence) {
                    i += 1;
                    break;
                }
                body.push(lines[i]);
                i += 1;
            }
            let mut block = String::from("```");
            block.push_str(&lang);
            block.push('\n');
            block.push_str(&escape_code(&body.join("\n")));
            block.push_str("\n```");
            out_lines.push(block);
            continue;
        }

        out_lines.push(convert_block_line(lines[i]));
        i += 1;
    }

    out_lines.join("\n")
}

/// Convert one line's block-level markers (headings, blockquotes, bullets) and
/// then its inline content into MarkdownV2.
fn convert_block_line(line: &str) -> String {
    let t = line.trim();
    if t.len() >= 3
        && (t.chars().all(|c| c == '-')
            || t.chars().all(|c| c == '*')
            || t.chars().all(|c| c == '_'))
    {
        return String::new();
    }

    let indent_len = line
        .char_indices()
        .find(|(_, c)| *c != ' ' && *c != '\t')
        .map(|(i, _)| i)
        .unwrap_or(line.len());
    let (indent, mut rest) = line.split_at(indent_len);

    if let Some(after) = rest.strip_prefix("> ") {
        rest = after;
    } else if let Some(after) = rest.strip_prefix('>') {
        rest = after;
    }

    // Headings have no MarkdownV2 equivalent, so render them bold.
    if rest.starts_with('#') {
        let hashes = rest.chars().take_while(|&c| c == '#').count();
        if hashes <= 6 {
            let after = &rest[hashes..];
            if after.is_empty() || after.starts_with(' ') {
                let content = after.trim_start();
                if content.is_empty() {
                    return String::new();
                }
                let chars: Vec<char> = content.chars().collect();
                return format!("{indent}*{}*", convert_inline(&chars));
            }
        }
    }

    for marker in ["- ", "* ", "+ "] {
        if let Some(after) = rest.strip_prefix(marker) {
            let chars: Vec<char> = after.chars().collect();
            return format!("{indent}\u{2022} {}", convert_inline(&chars));
        }
    }

    let chars: Vec<char> = rest.chars().collect();
    format!("{indent}{}", convert_inline(&chars))
}

/// Convert inline CommonMark markers to MarkdownV2, escaping literal text.
fn convert_inline(chars: &[char]) -> String {
    let mut out = String::new();
    let mut i = 0;
    let n = chars.len();

    while i < n {
        let c = chars[i];
        match c {
            '\\' if i + 1 < n => {
                push_escaped(&mut out, chars[i + 1]);
                i += 2;
            }
            '`' => {
                if let Some(rel) = chars[i + 1..].iter().position(|&x| x == '`') {
                    let end = i + 1 + rel;
                    let inner: String = chars[i + 1..end].iter().collect();
                    out.push('`');
                    out.push_str(&escape_code(&inner));
                    out.push('`');
                    i = end + 1;
                } else {
                    push_escaped(&mut out, '`');
                    i += 1;
                }
            }
            '!' if chars.get(i + 1) == Some(&'[') => {
                if let Some((text, url, end)) = parse_link(chars, i + 1) {
                    push_v2_link(&mut out, &text, &url);
                    i = end;
                } else {
                    push_escaped(&mut out, '!');
                    i += 1;
                }
            }
            '[' => {
                if let Some((text, url, end)) = parse_link(chars, i) {
                    push_v2_link(&mut out, &text, &url);
                    i = end;
                } else {
                    push_escaped(&mut out, '[');
                    i += 1;
                }
            }
            '*' => {
                if chars.get(i + 1) == Some(&'*') {
                    // **bold** -> *bold*
                    if let Some(end) = find_double(chars, i + 2, '*') {
                        let inner = convert_inline(&chars[i + 2..end]);
                        out.push('*');
                        out.push_str(&inner);
                        out.push('*');
                        i = end + 2;
                    } else {
                        push_escaped(&mut out, '*');
                        i += 1;
                    }
                } else if let Some(rel) = chars[i + 1..].iter().position(|&x| x == '*') {
                    // *italic* -> _italic_
                    let end = i + 1 + rel;
                    let inner = convert_inline(&chars[i + 1..end]);
                    out.push('_');
                    out.push_str(&inner);
                    out.push('_');
                    i = end + 1;
                } else {
                    push_escaped(&mut out, '*');
                    i += 1;
                }
            }
            '~' if chars.get(i + 1) == Some(&'~') => {
                // ~~strike~~ -> ~strike~
                if let Some(end) = find_double(chars, i + 2, '~') {
                    let inner = convert_inline(&chars[i + 2..end]);
                    out.push('~');
                    out.push_str(&inner);
                    out.push('~');
                    i = end + 2;
                } else {
                    push_escaped(&mut out, '~');
                    i += 1;
                }
            }
            _ => {
                push_escaped(&mut out, c);
                i += 1;
            }
        }
    }

    out
}

/// Find the next doubled `ch` (e.g. `**` or `~~`) at or after `start`.
fn find_double(chars: &[char], start: usize, ch: char) -> Option<usize> {
    let mut k = start;
    while k + 1 < chars.len() {
        if chars[k] == ch && chars[k + 1] == ch {
            return Some(k);
        }
        k += 1;
    }
    None
}

/// Push a MarkdownV2 link, escaping the label as text and the URL for `)`/`\`.
fn push_v2_link(out: &mut String, text: &str, url: &str) {
    let label = if text.trim().is_empty() {
        escape_text(url)
    } else {
        convert_inline(&text.chars().collect::<Vec<_>>())
    };
    out.push('[');
    out.push_str(&label);
    out.push(']');
    out.push('(');
    out.push_str(&escape_url(url.trim()));
    out.push(')');
}

/// Append `c`, prefixing a backslash when it is a MarkdownV2 special char.
fn push_escaped(out: &mut String, c: char) {
    if matches!(
        c,
        '_' | '*'
            | '['
            | ']'
            | '('
            | ')'
            | '~'
            | '`'
            | '>'
            | '#'
            | '+'
            | '-'
            | '='
            | '|'
            | '{'
            | '}'
            | '.'
            | '!'
            | '\\'
    ) {
        out.push('\\');
    }
    out.push(c);
}

/// Escape an entire string as MarkdownV2 body text.
fn escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        push_escaped(&mut out, c);
    }
    out
}

/// Escape a string for use inside a MarkdownV2 code span / pre-block.
fn escape_code(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c == '`' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escape a URL for use inside a MarkdownV2 link target.
fn escape_url(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if c == ')' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

#[async_trait]
impl ChatConnector for TelegramConnector {
    fn kind(&self) -> ChannelKind {
        ChannelKind::Telegram
    }

    async fn send_text(&self, chat_ref: &str, text: &str) -> Result<(), ChannelError> {
        let url = self.method_url("sendMessage");

        // Render to MarkdownV2 so bold/italic/code style natively. If Telegram
        // rejects the very first chunk (e.g. a malformed entity yields HTTP
        // 400), fall back to plain stripped text so the message still lands.
        let formatted = to_markdown_v2(text);
        let mut sent_any = false;
        for chunk in split_message(&formatted, TELEGRAM_MESSAGE_LIMIT) {
            match self
                .post_message(&url, chat_ref, &chunk, Some("MarkdownV2"))
                .await
            {
                Ok(()) => sent_any = true,
                Err(e) if !sent_any => {
                    tracing::warn!(
                        error = %e,
                        "telegram MarkdownV2 send failed; falling back to plain text"
                    );
                    let plain = strip_markdown(text);
                    for chunk in split_message(&plain, TELEGRAM_MESSAGE_LIMIT) {
                        self.post_message(&url, chat_ref, &chunk, None).await?;
                    }
                    return Ok(());
                }
                Err(e) => return Err(e),
            }
        }
        Ok(())
    }

    async fn send_typing(&self, chat_ref: &str) -> Result<(), ChannelError> {
        let url = self.method_url("sendChatAction");
        let resp = self
            .http
            .post(&url)
            .json(&json!({ "chat_id": chat_ref, "action": "typing" }))
            .send()
            .await
            .map_err(|e| ChannelError::Transport(e.to_string()))?;
        if !resp.status().is_success() {
            return Err(ChannelError::Transport(format!(
                "sendChatAction failed ({})",
                resp.status()
            )));
        }
        Ok(())
    }

    async fn run(self: Arc<Self>, handler: Arc<dyn InboundHandler>) -> Result<(), ChannelError> {
        let url = self.method_url("getUpdates");
        loop {
            let offset = self.offset.load(Ordering::SeqCst);
            let result = self
                .http
                .get(&url)
                .query(&[
                    ("offset", offset.to_string()),
                    ("timeout", LONG_POLL_TIMEOUT_SECS.to_string()),
                ])
                .send()
                .await;

            let resp = match result {
                Ok(resp) => resp,
                Err(e) => {
                    tracing::warn!(error = %e, "telegram getUpdates request failed");
                    tokio::time::sleep(POLL_BACKOFF).await;
                    continue;
                }
            };

            let body: Value = match resp.json().await {
                Ok(body) => body,
                Err(e) => {
                    tracing::warn!(error = %e, "telegram getUpdates decode failed");
                    tokio::time::sleep(POLL_BACKOFF).await;
                    continue;
                }
            };

            let Some(updates) = body.get("result").and_then(|r| r.as_array()) else {
                tracing::warn!("telegram getUpdates missing result array");
                tokio::time::sleep(POLL_BACKOFF).await;
                continue;
            };

            let mut max_update_id = offset - 1;
            for update in updates {
                if let Some(update_id) = update.get("update_id").and_then(|v| v.as_i64()) {
                    if update_id > max_update_id {
                        max_update_id = update_id;
                    }
                }

                // Be defensive: skip anything that isn't a text message.
                let Some(message) = update.get("message") else {
                    continue;
                };
                let Some(chat_id) = message
                    .get("chat")
                    .and_then(|c| c.get("id"))
                    .and_then(|id| id.as_i64())
                else {
                    continue;
                };
                let Some(text) = message.get("text").and_then(|t| t.as_str()) else {
                    continue;
                };

                let msg = build_inbound(chat_id.to_string(), text);
                handler.on_message(msg).await;
            }

            // Acknowledge consumed updates so Telegram drops them.
            let next_offset = max_update_id + 1;
            if next_offset > offset {
                self.offset.store(next_offset, Ordering::SeqCst);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_under_limit_single_chunk() {
        let chunks = split_message("hello world", 4096);
        assert_eq!(chunks, vec!["hello world".to_string()]);
    }

    #[test]
    fn split_empty_yields_single_empty_chunk() {
        assert_eq!(split_message("", 10), vec![String::new()]);
    }

    #[test]
    fn split_over_limit_hard_splits_when_no_newline() {
        let text = "a".repeat(25);
        let chunks = split_message(&text, 10);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].chars().count(), 10);
        assert_eq!(chunks[1].chars().count(), 10);
        assert_eq!(chunks[2].chars().count(), 5);
        for c in &chunks {
            assert!(c.chars().count() <= 10);
        }
        assert_eq!(chunks.concat(), text);
    }

    #[test]
    fn split_prefers_newline_boundary() {
        // First line is 6 chars, then newline, then a long run. With limit 10
        // the split should occur on the newline, not mid-line.
        let text = "line01\nABCDEFGHIJKLMNO";
        let chunks = split_message(text, 10);
        assert_eq!(chunks[0], "line01");
        // Remaining 15 chars hard-split into <=10 windows.
        assert!(chunks[1].chars().count() <= 10);
        for c in &chunks {
            assert!(c.chars().count() <= 10);
        }
    }

    #[test]
    fn split_all_chunks_within_limit() {
        let text = "word ".repeat(3000);
        for chunk in split_message(&text, 4096) {
            assert!(chunk.chars().count() <= 4096);
        }
    }

    #[test]
    fn strip_removes_bold_and_italic() {
        assert_eq!(
            strip_markdown("**Philosophical takes:** you *create* meaning"),
            "Philosophical takes: you create meaning"
        );
    }

    #[test]
    fn strip_headings_and_bullets() {
        let input = "# Title\n## Subtitle\n- first\n* second\n+ third";
        let expected = "Title\nSubtitle\n\u{2022} first\n\u{2022} second\n\u{2022} third";
        assert_eq!(strip_markdown(input), expected);
    }

    #[test]
    fn strip_inline_code_and_strikethrough() {
        assert_eq!(
            strip_markdown("run `cargo test` and ~~skip~~ this"),
            "run cargo test and skip this"
        );
    }

    #[test]
    fn strip_links_keep_url() {
        assert_eq!(
            strip_markdown("see [the docs](https://example.com)"),
            "see the docs (https://example.com)"
        );
    }

    #[test]
    fn strip_link_with_matching_text_and_url() {
        assert_eq!(
            strip_markdown("[https://example.com](https://example.com)"),
            "https://example.com"
        );
    }

    #[test]
    fn strip_image_becomes_alt_and_url() {
        assert_eq!(
            strip_markdown("![diagram](https://img/d.png)"),
            "diagram (https://img/d.png)"
        );
    }

    #[test]
    fn strip_preserves_snake_case_identifiers() {
        assert_eq!(
            strip_markdown("call my_function with __bold__ here"),
            "call my_function with bold here"
        );
    }

    #[test]
    fn strip_keeps_code_fence_body_verbatim() {
        let input = "before\n```rust\nlet x = *ptr;\n```\nafter";
        assert_eq!(strip_markdown(input), "before\nlet x = *ptr;\nafter");
    }

    #[test]
    fn strip_handles_escaped_markers() {
        assert_eq!(strip_markdown("literal \\*stars\\*"), "literal *stars*");
    }

    #[test]
    fn v2_bold_becomes_single_asterisk() {
        assert_eq!(to_markdown_v2("**bold** text"), "*bold* text");
    }

    #[test]
    fn v2_italic_becomes_underscore() {
        assert_eq!(
            to_markdown_v2("you *create* meaning"),
            "you _create_ meaning"
        );
    }

    #[test]
    fn v2_strikethrough_single_tilde() {
        assert_eq!(to_markdown_v2("~~old~~ new"), "~old~ new");
    }

    #[test]
    fn v2_escapes_literal_special_chars() {
        // Periods, parens, hyphens, etc. must be escaped in body text.
        assert_eq!(
            to_markdown_v2("ship it (now) - really."),
            "ship it \\(now\\) \\- really\\."
        );
    }

    #[test]
    fn v2_heading_becomes_bold() {
        assert_eq!(to_markdown_v2("# Title"), "*Title*");
        assert_eq!(to_markdown_v2("## Subtitle"), "*Subtitle*");
    }

    #[test]
    fn v2_bullets_use_bullet_glyph() {
        assert_eq!(
            to_markdown_v2("- first\n* second"),
            "\u{2022} first\n\u{2022} second"
        );
    }

    #[test]
    fn v2_link_label_and_url_escaped() {
        assert_eq!(
            to_markdown_v2("see [the docs](https://example.com/a.b)"),
            "see [the docs](https://example.com/a.b)"
        );
    }

    #[test]
    fn v2_inline_code_preserved_and_escaped() {
        // Backtick stays a code entity; the period inside is NOT escaped.
        assert_eq!(to_markdown_v2("run `a.b()` now"), "run `a.b()` now");
    }

    #[test]
    fn v2_code_fence_becomes_pre_block() {
        let input = "```rust\nlet x = 1.0;\n```";
        assert_eq!(to_markdown_v2(input), "```rust\nlet x = 1.0;\n```");
    }

    #[test]
    fn v2_preserves_snake_case() {
        // Single underscores in identifiers are escaped, not treated as italic.
        assert_eq!(to_markdown_v2("call my_func now"), "call my\\_func now");
    }

    #[test]
    fn v2_nested_bold_italic() {
        assert_eq!(to_markdown_v2("**big *small* end**"), "*big _small_ end*");
    }
}
