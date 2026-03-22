use std::sync::OnceLock;

use regex::Regex;

pub(crate) use aura_link::build::{classify_build_errors, error_category_guidance, ErrorCategory};

use crate::file_ops;

fn type_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"found for (?:struct|enum|trait|union) `(\w+)").expect("static regex")
    })
}
fn init_type_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"in initializer of `(?:\w+::)*(\w+)`").expect("static regex"))
}
fn method_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"no method named `(\w+)` found for (?:\w+ )?`(?:&(?:mut )?)?(\w+)")
            .expect("static regex")
    })
}
fn field_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"missing field `(\w+)` in initializer of `(?:\w+::)*(\w+)`")
            .expect("static regex")
    })
}
fn no_field_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"struct `(?:\w+::)*(\w+)` has no field named `(\w+)`").expect("static regex")
    })
}
fn loc_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"-->\s*([\w\\/._-]+):(\d+):\d+").expect("static regex"))
}
fn arg_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"takes (\d+) arguments? but (\d+)").expect("static regex"))
}

/// Tracks a single build-fix attempt for the retry history prompt.
pub(crate) struct BuildFixAttemptRecord {
    pub stderr: String,
    pub error_signature: String,
    pub files_changed: Vec<String>,
    pub changes_summary: String,
}

pub(crate) fn parse_error_references(stderr: &str) -> file_ops::ErrorReferences {
    let mut refs = file_ops::ErrorReferences::default();

    for cap in type_re().captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    for cap in init_type_re().captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    for cap in method_re().captures_iter(stderr) {
        let method = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.methods_not_found.push((type_name.clone(), method));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    for cap in field_re().captures_iter(stderr) {
        let field = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.missing_fields.push((type_name.clone(), field));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    for cap in no_field_re().captures_iter(stderr) {
        let type_name = cap[1].to_string();
        let field = cap[2].to_string();
        refs.missing_fields.push((type_name.clone(), field));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    for cap in loc_re().captures_iter(stderr) {
        let file = cap[1].to_string();
        let line: u32 = cap[2].parse().unwrap_or(0);
        if !refs
            .source_locations
            .iter()
            .any(|(f, l)| f == &file && *l == line)
        {
            refs.source_locations.push((file, line));
        }
    }

    for cap in arg_re().captures_iter(stderr) {
        refs.wrong_arg_counts
            .push(format!("expected {} got {}", &cap[1], &cap[2]));
    }

    refs
}
