use chrono::{DateTime, Utc};

/// Parse an optional RFC 3339 timestamp into `DateTime<Utc>`, falling back to
/// `Utc::now()` when the value is `None` or malformed.
pub fn parse_dt(value: &Option<String>) -> DateTime<Utc> {
    value
        .as_deref()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

/// Extract the first fenced code block from `text`, stripping the opening
/// `` ```json `` or bare `` ``` `` marker and the closing `` ``` ``.
pub fn extract_fenced_json(text: &str) -> Option<String> {
    let start_markers = ["```json", "```"];
    for marker in &start_markers {
        if let Some(start) = text.find(marker) {
            let after_marker = start + marker.len();
            if let Some(end) = text[after_marker..].find("```") {
                return Some(text[after_marker..after_marker + end].trim().to_string());
            }
        }
    }
    None
}

/// Whitespace-normalised search-and-replace that succeeds only when exactly one
/// match is found (after trimming each line). Returns `None` on zero or
/// multiple matches.
pub fn fuzzy_search_replace(content: &str, search: &str, replace: &str) -> Option<String> {
    let search_lines: Vec<&str> = search.lines().map(|l| l.trim()).collect();
    if search_lines.is_empty() || search_lines.iter().all(|l| l.is_empty()) {
        return None;
    }

    let content_lines: Vec<&str> = content.lines().collect();
    let mut match_positions: Vec<usize> = Vec::new();

    'outer: for start in 0..content_lines.len() {
        if start + search_lines.len() > content_lines.len() {
            break;
        }
        for (j, search_line) in search_lines.iter().enumerate() {
            if content_lines[start + j].trim() != *search_line {
                continue 'outer;
            }
        }
        match_positions.push(start);
    }

    if match_positions.len() != 1 {
        return None;
    }

    let match_start = match_positions[0];
    let match_end = match_start + search_lines.len();

    let mut result = String::with_capacity(content.len());
    for (i, line) in content_lines.iter().enumerate() {
        if i == match_start {
            result.push_str(replace);
            if !replace.ends_with('\n') {
                result.push('\n');
            }
        } else if i >= match_start && i < match_end {
            continue;
        } else {
            result.push_str(line);
            result.push('\n');
        }
    }
    if !content.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_dt_none_falls_back_to_now() {
        let before = Utc::now();
        let dt = parse_dt(&None);
        assert!(dt >= before);
    }

    #[test]
    fn parse_dt_valid_rfc3339() {
        use chrono::Datelike;
        let dt = parse_dt(&Some("2025-01-15T12:00:00Z".to_string()));
        assert_eq!(dt.year(), 2025);
    }

    #[test]
    fn parse_dt_invalid_falls_back_to_now() {
        let before = Utc::now();
        let dt = parse_dt(&Some("not-a-date".to_string()));
        assert!(dt >= before);
    }

    #[test]
    fn extract_fenced_json_with_json_marker() {
        let input = "some text\n```json\n{\"a\":1}\n```\nmore";
        assert_eq!(extract_fenced_json(input), Some("{\"a\":1}".to_string()));
    }

    #[test]
    fn extract_fenced_json_bare_fence() {
        let input = "```\nhello\n```";
        assert_eq!(extract_fenced_json(input), Some("hello".to_string()));
    }

    #[test]
    fn extract_fenced_json_none_when_no_fence() {
        assert_eq!(extract_fenced_json("no fences here"), None);
    }

    #[test]
    fn fuzzy_search_replace_matches_with_whitespace_difference() {
        let content = "  fn foo() {\n    bar();\n  }\n";
        let search = "fn foo() {\nbar();\n}";
        let replace = "fn foo() {\n    baz();\n}";
        let result = fuzzy_search_replace(content, search, replace).unwrap();
        assert!(result.contains("baz"));
    }

    #[test]
    fn fuzzy_search_replace_none_on_no_match() {
        let content = "fn foo() {}\n";
        let search = "fn bar() {}";
        let replace = "fn baz() {}";
        assert!(fuzzy_search_replace(content, search, replace).is_none());
    }
}
