/// Heuristic: does this content look like Rust source code?
/// Checks the first 2000 chars for common Rust syntax patterns.
pub fn looks_like_rust(content: &str) -> bool {
    let start = &content[..content.len().min(2000)];
    let mut signals = 0u32;

    if start.contains("use ") || start.contains("pub use ") { signals += 1; }
    if start.contains("pub fn ") || start.contains("fn ") { signals += 1; }
    if start.contains("pub struct ") || start.contains("struct ") { signals += 1; }
    if start.contains("impl ") { signals += 1; }
    if start.contains("pub mod ") || start.contains("mod ") { signals += 1; }
    if start.contains("pub enum ") || start.contains("enum ") { signals += 1; }
    if start.contains("pub trait ") || start.contains("trait ") { signals += 1; }
    if start.contains("-> Result<") || start.contains("-> Option<") { signals += 1; }

    signals >= 3
}

/// Extract public API signatures from Rust source content.
///
/// Keeps `use`/`mod` declarations, pub struct/enum definitions (with
/// fields/variants), pub trait method signatures, pub fn signatures, and impl
/// block method signatures.  Bodies are replaced with `{ ... }`.
///
/// Each significant item is prefixed with its line number (1-indexed) so the
/// caller can use `read_file` with `start_line`/`end_line` to fetch the full
/// definition.
///
/// Typically produces ~25-30% of the original file size while preserving the
/// full API surface.
pub fn extract_signatures(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut output = String::new();
    let mut i = 0;

    while i < lines.len() {
        if let Some(next) = try_process_preamble(&lines, i, &mut output) {
            i = next;
        } else if let Some(next) = try_process_definition(&lines, i, &mut output) {
            i = next;
        } else {
            i += 1;
        }
    }

    output
}

fn try_process_preamble(lines: &[&str], i: usize, output: &mut String) -> Option<usize> {
    let trimmed = lines[i].trim();

    if trimmed.starts_with("use ")
        || trimmed.starts_with("pub use ")
        || trimmed.starts_with("pub mod ")
        || trimmed.starts_with("mod ")
        || trimmed.starts_with("//!")
    {
        output.push_str(trimmed);
        output.push('\n');
        return Some(i + 1);
    }

    if trimmed.starts_with("//") || trimmed.is_empty() {
        return Some(i + 1);
    }

    if trimmed.starts_with("#[") {
        push_with_line(output, i, trimmed);
        return Some(i + 1);
    }

    None
}

fn try_process_definition(lines: &[&str], i: usize, output: &mut String) -> Option<usize> {
    let trimmed = lines[i].trim();

    if (trimmed.starts_with("pub struct ") || trimmed.starts_with("pub enum "))
        && !trimmed.ends_with(';')
    {
        let (block, end) = extract_braced_block(lines, i);
        push_with_line(output, i, &block);
        return Some(end + 1);
    }

    if trimmed.starts_with("pub trait ") {
        let (block, end) = extract_trait_signatures(lines, i);
        push_with_line(output, i, &block);
        return Some(end + 1);
    }

    if trimmed.starts_with("impl ") || trimmed.starts_with("impl<") {
        let (block, end) = extract_impl_signatures(lines, i);
        if !block.is_empty() {
            push_with_line(output, i, &block);
        }
        return Some(end + 1);
    }

    if trimmed.starts_with("pub fn ")
        || trimmed.starts_with("pub async fn ")
        || trimmed.starts_with("pub const fn ")
        || trimmed.starts_with("pub unsafe fn ")
    {
        let sig = extract_fn_signature(lines, i);
        let formatted = format!("{sig} {{ ... }}");
        push_with_line(output, i, &formatted);
        return Some(skip_braced_block(lines, i) + 1);
    }

    if trimmed.starts_with("pub type ") || trimmed.starts_with("pub const ") {
        push_with_line(output, i, trimmed);
        return Some(i + 1);
    }

    None
}

fn push_with_line(output: &mut String, line_idx: usize, content: &str) {
    let line_num = line_idx + 1;
    if content.contains('\n') {
        let first_line = content.lines().next().unwrap_or("");
        output.push_str(&format!("L{line_num}: {first_line}\n"));
        for rest in content.lines().skip(1) {
            output.push_str(rest);
            output.push('\n');
        }
    } else {
        output.push_str(&format!("L{line_num}: {content}\n"));
    }
}

fn extract_braced_block(lines: &[&str], start: usize) -> (String, usize) {
    let mut depth: i32 = 0;
    let mut result = String::new();
    let mut started = false;

    for (j, line) in lines.iter().enumerate().skip(start) {
        for ch in line.chars() {
            match ch {
                '{' => { depth += 1; started = true; }
                '}' => depth -= 1,
                _ => {}
            }
        }
        result.push_str(line.trim());
        result.push('\n');
        if started && depth <= 0 {
            return (result, j);
        }
    }
    (result, lines.len().saturating_sub(1))
}

fn extract_trait_signatures(lines: &[&str], start: usize) -> (String, usize) {
    extract_method_signatures(lines, start, false)
}

fn extract_impl_signatures(lines: &[&str], start: usize) -> (String, usize) {
    let header = lines[start].trim();
    let is_trait_impl = header.contains(" for ");

    if !impl_has_pub_methods(lines, start, is_trait_impl) && !is_trait_impl {
        let end = skip_braced_block(lines, start);
        return (String::new(), end);
    }

    extract_method_signatures(lines, start, true)
}

fn impl_has_pub_methods(lines: &[&str], start: usize, is_trait_impl: bool) -> bool {
    let mut depth: i32 = 0;
    let mut started = false;
    let mut in_fn_body = false;
    let mut fn_body_depth: i32 = 0;

    for line in lines.iter().skip(start) {
        let trimmed = line.trim();

        for ch in trimmed.chars() {
            match ch {
                '{' => { depth += 1; started = true; }
                '}' => depth -= 1,
                _ => {}
            }
        }

        if in_fn_body {
            fn_body_depth += trimmed.chars().filter(|&c| c == '{').count() as i32;
            fn_body_depth -= trimmed.chars().filter(|&c| c == '}').count() as i32;
            if fn_body_depth <= 0 { in_fn_body = false; }
            if started && depth <= 0 { break; }
            continue;
        }

        if started && depth > 1 {
            let is_fn = is_fn_start(trimmed);
            if is_fn {
                if trimmed.starts_with("pub ") || is_trait_impl {
                    return true;
                }
                if trimmed.contains('{') {
                    fn_body_depth = trimmed.chars().filter(|&c| c == '{').count() as i32
                        - trimmed.chars().filter(|&c| c == '}').count() as i32;
                    if fn_body_depth > 0 { in_fn_body = true; }
                }
            }
        }

        if started && depth <= 0 { break; }
    }
    false
}

fn format_method_entry(trimmed: &str) -> (String, i32) {
    let mut formatted = String::from("    ");
    if trimmed.contains('{') {
        let sig_part = match trimmed.find('{') {
            Some(pos) => trimmed[..pos].trim(),
            None => trimmed,
        };
        formatted.push_str(sig_part);
        formatted.push_str(" { ... }\n");
    } else {
        formatted.push_str(trimmed);
        formatted.push('\n');
    }
    let body_depth = trimmed.chars().filter(|&c| c == '{').count() as i32
        - trimmed.chars().filter(|&c| c == '}').count() as i32;
    (formatted, body_depth)
}

fn is_impl_noise(trimmed: &str, header: &str) -> bool {
    !trimmed.is_empty()
        && !trimmed.starts_with("pub ")
        && !trimmed.starts_with("fn ")
        && !trimmed.starts_with("async fn ")
        && !trimmed.starts_with("type ")
        && !trimmed.starts_with("const ")
        && !trimmed.starts_with("//")
        && !trimmed.starts_with('}')
        && !trimmed.starts_with('{')
        && !header.contains(trimmed)
}

/// Shared extraction logic for trait and impl blocks.
/// When `filter_impl_noise` is true, non-fn lines inside the block that don't
/// look like associated types/consts are skipped (impl-block behaviour).
fn extract_method_signatures(
    lines: &[&str],
    start: usize,
    filter_impl_noise: bool,
) -> (String, usize) {
    let mut depth: i32 = 0;
    let mut result = String::new();
    let mut started = false;
    let mut in_fn_body = false;
    let mut fn_body_depth: i32 = 0;
    let header = lines.get(start).map_or("", |l| l.trim());

    for (j, line) in lines.iter().enumerate().skip(start) {
        let trimmed = line.trim();

        for ch in trimmed.chars() {
            match ch {
                '{' => { depth += 1; started = true; }
                '}' => depth -= 1,
                _ => {}
            }
        }

        if in_fn_body {
            fn_body_depth += trimmed.chars().filter(|&c| c == '{').count() as i32;
            fn_body_depth -= trimmed.chars().filter(|&c| c == '}').count() as i32;
            if fn_body_depth <= 0 { in_fn_body = false; }
            if started && depth <= 0 {
                result.push_str("}\n");
                return (result, j);
            }
            continue;
        }

        if started && depth > 1 && is_fn_start(trimmed) {
            let (entry, body_depth) = format_method_entry(trimmed);
            result.push_str(&entry);
            if trimmed.contains('{') && body_depth > 0 {
                in_fn_body = true;
                fn_body_depth = body_depth;
            }
            if started && depth <= 0 { return (result, j); }
            continue;
        }

        if filter_impl_noise && started && depth >= 1
            && j != start && is_impl_noise(trimmed, header)
        {
            if started && depth <= 0 {
                result.push_str("}\n");
                return (result, j);
            }
            continue;
        }

        result.push_str(trimmed);
        result.push('\n');

        if started && depth <= 0 {
            return (result, j);
        }
    }
    (result, lines.len().saturating_sub(1))
}

fn is_fn_start(trimmed: &str) -> bool {
    trimmed.starts_with("pub fn ")
        || trimmed.starts_with("pub async fn ")
        || trimmed.starts_with("pub const fn ")
        || trimmed.starts_with("pub(crate) fn ")
        || trimmed.starts_with("pub(crate) async fn ")
        || trimmed.starts_with("fn ")
        || trimmed.starts_with("async fn ")
}

fn extract_fn_signature(lines: &[&str], start: usize) -> String {
    let mut sig = String::new();
    for line in lines.iter().skip(start) {
        let trimmed = line.trim();
        if let Some(pos) = trimmed.find('{') {
            let before = trimmed[..pos].trim();
            if !before.is_empty() {
                if !sig.is_empty() { sig.push(' '); }
                sig.push_str(before);
            }
            break;
        }
        if !sig.is_empty() { sig.push(' '); }
        sig.push_str(trimmed);
    }
    sig
}

fn skip_braced_block(lines: &[&str], start: usize) -> usize {
    let mut depth: i32 = 0;
    let mut started = false;
    for (j, line) in lines.iter().enumerate().skip(start) {
        for ch in line.chars() {
            match ch {
                '{' => { depth += 1; started = true; }
                '}' => depth -= 1,
                _ => {}
            }
        }
        if started && depth <= 0 {
            return j;
        }
    }
    lines.len().saturating_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_looks_like_rust_positive() {
        let src = "use std::path::Path;\npub fn foo() {}\nstruct Bar {}\nimpl Bar {}\n";
        assert!(looks_like_rust(src));
    }

    #[test]
    fn test_looks_like_rust_negative() {
        let src = "import React from 'react';\nfunction App() { return <div/>; }\n";
        assert!(!looks_like_rust(src));
    }

    #[test]
    fn test_extract_signatures_fn() {
        let src = "pub fn hello(name: &str) -> String {\n    format!(\"Hello {name}\")\n}\n";
        let sigs = extract_signatures(src);
        assert!(sigs.contains("L1: pub fn hello(name: &str) -> String { ... }"));
        assert!(!sigs.contains("format!"));
    }

    #[test]
    fn test_extract_signatures_struct() {
        let src = "pub struct Foo {\n    pub bar: u32,\n    pub baz: String,\n}\n";
        let sigs = extract_signatures(src);
        assert!(sigs.contains("L1: pub struct Foo"));
        assert!(sigs.contains("pub bar: u32"));
    }

    #[test]
    fn test_extract_signatures_trait() {
        let src = r#"pub trait MyTrait {
    fn required(&self) -> u32;
    fn default_impl(&self) -> u32 {
        42
    }
}
"#;
        let sigs = extract_signatures(src);
        assert!(sigs.contains("L1: pub trait MyTrait"));
        assert!(sigs.contains("fn required(&self) -> u32;"));
        assert!(sigs.contains("fn default_impl(&self) -> u32 { ... }"));
        assert!(!sigs.contains("42"));
    }

    #[test]
    fn test_extract_signatures_impl() {
        let src = r#"impl Foo {
    pub fn new() -> Self {
        Foo { bar: 0, baz: String::new() }
    }
    fn private_helper(&self) {}
}
"#;
        let sigs = extract_signatures(src);
        assert!(sigs.contains("L1: impl Foo"));
        assert!(sigs.contains("pub fn new() -> Self { ... }"));
    }

    #[test]
    fn test_extract_signatures_line_numbers() {
        let src = "use std::io;\n\n\npub struct Bar {\n    pub x: i32,\n}\n\npub fn baz() {\n    todo!()\n}\n";
        let sigs = extract_signatures(src);
        assert!(sigs.contains("L4: pub struct Bar"));
        assert!(sigs.contains("L8: pub fn baz() { ... }"));
    }
}
