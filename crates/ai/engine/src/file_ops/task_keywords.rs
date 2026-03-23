use std::collections::HashMap;
use std::sync::OnceLock;

use regex::Regex;

fn pascal_case_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b([A-Z][a-zA-Z0-9]+)\b").expect("static regex"))
}
fn crate_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b(aura[_-]\w+)\b").expect("static regex"))
}
fn module_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\b([a-z][a-z0-9_]{2,})\b").expect("static regex"))
}

pub(crate) fn extract_task_keywords(task_title: &str, task_description: &str) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description);
    let mut keywords: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in pascal_case_re().captures_iter(&combined) {
        let word = cap[1].to_string();
        if word.len() >= 3 && !COMMON_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    for cap in crate_name_re().captures_iter(&combined) {
        let name = cap[1].replace('-', "_");
        if seen.insert(name.clone()) {
            keywords.push(name);
        }
    }

    for cap in module_name_re().captures_iter(&combined) {
        let word = cap[1].to_string();
        if !COMMON_MODULE_STOP_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            keywords.push(word);
        }
    }

    keywords
}

pub(crate) const COMMON_WORDS: &[&str] = &[
    "The",
    "This",
    "That",
    "With",
    "From",
    "Into",
    "Each",
    "Some",
    "None",
    "Result",
    "Option",
    "String",
    "Vec",
    "HashMap",
    "Arc",
    "Box",
    "Mutex",
    "Default",
    "Clone",
    "Debug",
    "Display",
    "Error",
    "Send",
    "Sync",
    "Implement",
    "Create",
    "Update",
    "Delete",
    "Add",
    "Remove",
    "Set",
    "Get",
    "New",
    "Test",
    "Build",
    "Run",
    "Fix",
    "Use",
    "For",
    "All",
    "Any",
];

const COMMON_MODULE_STOP_WORDS: &[&str] = &[
    "the",
    "this",
    "that",
    "with",
    "from",
    "into",
    "each",
    "some",
    "none",
    "and",
    "for",
    "not",
    "are",
    "but",
    "all",
    "any",
    "can",
    "has",
    "was",
    "will",
    "use",
    "its",
    "let",
    "new",
    "our",
    "try",
    "may",
    "should",
    "must",
    "also",
    "just",
    "than",
    "then",
    "when",
    "who",
    "how",
    "what",
    "pub",
    "mod",
    "impl",
    "self",
    "super",
    "crate",
    "where",
    "type",
    "struct",
    "enum",
    "trait",
    "async",
    "await",
    "move",
    "return",
    "true",
    "false",
    "mut",
    "ref",
    "str",
    "run",
    "set",
    "get",
    "add",
    "using",
    "create",
    "implement",
    "update",
    "delete",
    "task",
    "file",
    "code",
    "test",
    "build",
    "make",
    "does",
    "like",
    "have",
    "been",
];

/// Identify which workspace crate(s) the task most likely targets.
pub(crate) fn identify_target_crates(
    task_title: &str,
    task_description: &str,
    members: &[String],
    crate_names: &HashMap<String, String>,
) -> Vec<String> {
    let combined = format!("{} {}", task_title, task_description).to_lowercase();

    let mut scored: Vec<(String, u32)> = members
        .iter()
        .map(|member| {
            let name = crate_names
                .get(member)
                .cloned()
                .unwrap_or_default()
                .to_lowercase();
            let name_underscored = name.replace('-', "_");
            let name_dashed = name.replace('_', "-");
            let mut score: u32 = 0;

            if combined.contains(&name)
                || combined.contains(&name_underscored)
                || combined.contains(&name_dashed)
            {
                score += 10;
            }

            let last_segment = member.rsplit('/').next().unwrap_or(member);
            if combined.contains(&last_segment.to_lowercase()) {
                score += 5;
            }

            (member.clone(), score)
        })
        .filter(|(_, score)| *score > 0)
        .collect();

    scored.sort_by(|a, b| b.1.cmp(&a.1));
    scored.into_iter().map(|(m, _)| m).collect()
}

/// Extract PascalCase type names from text, filtering out standard library types
/// and common English words.
pub(crate) fn extract_type_names_from_text(text: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for cap in pascal_case_re().captures_iter(text) {
        let word = cap[1].to_string();
        if word.len() >= 3 && !COMMON_WORDS.contains(&word.as_str()) && seen.insert(word.clone()) {
            names.push(word);
        }
    }

    names
}
