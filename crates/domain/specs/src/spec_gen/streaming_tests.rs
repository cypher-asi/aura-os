use super::*;

// -----------------------------------------------------------------------
// parse_title_and_summary
// -----------------------------------------------------------------------

#[test]
fn parse_title_and_summary_standard_format() {
    let input = "TITLE: My Project\n\nThis is the summary of the project.";
    let (title, summary) = parse_title_and_summary(input, 100);
    assert_eq!(title, Some("My Project".to_string()));
    assert_eq!(summary, "This is the summary of the project.");
}

#[test]
fn parse_title_and_summary_case_insensitive() {
    let input = "title: Cool App\n\nA cool application.";
    let (title, summary) = parse_title_and_summary(input, 100);
    assert_eq!(title, Some("Cool App".to_string()));
    assert_eq!(summary, "A cool application.");
}

#[test]
fn parse_title_and_summary_no_title_prefix() {
    let input = "Just a summary without any title marker.";
    let (title, summary) = parse_title_and_summary(input, 100);
    assert!(title.is_none());
    assert_eq!(summary, "Just a summary without any title marker.");
}

#[test]
fn parse_title_and_summary_truncates_long_summary() {
    let input = "TITLE: T\n\none two three four five six seven eight nine ten eleven";
    let (title, summary) = parse_title_and_summary(input, 5);
    assert_eq!(title, Some("T".to_string()));
    assert_eq!(summary, "one two three four five");
}

#[test]
fn parse_title_and_summary_whitespace_only_after_prefix() {
    let input = "TITLE:   ";
    let (title, summary) = parse_title_and_summary(input, 100);
    assert!(title.is_none());
    assert!(summary.is_empty());
}

#[test]
fn parse_title_and_summary_single_line_title() {
    let input = "TITLE: Only Title";
    let (title, summary) = parse_title_and_summary(input, 100);
    assert_eq!(title, Some("Only Title".to_string()));
    assert!(summary.is_empty() || summary.is_empty());
}

// -----------------------------------------------------------------------
// truncate_to_max_words
// -----------------------------------------------------------------------

#[test]
fn truncate_within_limit() {
    assert_eq!(truncate_to_max_words("a b c", 5), "a b c");
}

#[test]
fn truncate_over_limit() {
    assert_eq!(truncate_to_max_words("a b c d e f", 3), "a b c");
}

#[test]
fn truncate_empty() {
    assert_eq!(truncate_to_max_words("", 10), "");
}

// -----------------------------------------------------------------------
// extract_purpose_excerpt
// -----------------------------------------------------------------------

#[test]
fn extract_purpose_from_markdown() {
    let md = "## Purpose\n\nThis module handles authentication.\n\n## Tasks\n\n| ID | T |";
    let excerpt = extract_purpose_excerpt(md, 500);
    assert_eq!(excerpt, "This module handles authentication.");
}

#[test]
fn extract_purpose_truncates() {
    let md = "## Purpose\n\nA very long description that goes on and on.";
    let excerpt = extract_purpose_excerpt(md, 10);
    assert!(excerpt.ends_with("..."));
    assert!(excerpt.len() <= 15);
}

#[test]
fn extract_purpose_missing_section() {
    let md = "## Tasks\n\nSome tasks here.";
    let excerpt = extract_purpose_excerpt(md, 500);
    assert!(excerpt.is_empty());
}
