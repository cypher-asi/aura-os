use crate::file_ops;

/// Tracks a single build-fix attempt for the retry history prompt.
pub(crate) struct BuildFixAttemptRecord {
    pub stderr: String,
    pub error_signature: String,
    pub files_changed: Vec<String>,
}

/// Classify build errors into categories so the fix prompt can include
/// targeted guidance instead of generic "try a different approach."
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ErrorCategory {
    RustStringLiteral,
    RustMissingModule,
    RustMissingMethod,
    RustTypeError,
    RustBorrowCheck,
    RustStructFieldMismatch,
    RustApiHallucination,
    NpmDependency,
    NpmTypeScript,
    GenericSyntax,
    Unknown,
}

pub(crate) fn classify_build_errors(stderr: &str) -> Vec<ErrorCategory> {
    let mut categories = Vec::new();

    let rust_string_patterns = [
        "unknown start of token",
        "prefix `",
        "unknown prefix",
        "Unicode character",
        "looks like",
        "but it is not",
    ];
    if rust_string_patterns.iter().any(|p| stderr.contains(p)) {
        categories.push(ErrorCategory::RustStringLiteral);
    }

    if stderr.contains("file not found for module") || stderr.contains("E0583") {
        categories.push(ErrorCategory::RustMissingModule);
    }

    if stderr.contains("no method named") || stderr.contains("E0599") {
        categories.push(ErrorCategory::RustMissingMethod);
    }

    if stderr.contains("missing field") || stderr.contains("E0063")
        || stderr.contains("has no field named") || stderr.contains("E0560")
    {
        categories.push(ErrorCategory::RustStructFieldMismatch);
    }

    if stderr.contains("the trait") && stderr.contains("is not implemented")
        || stderr.contains("E0277")
        || stderr.contains("type annotations needed")
        || stderr.contains("E0283")
    {
        categories.push(ErrorCategory::RustTypeError);
    }

    if stderr.contains("cannot borrow") || stderr.contains("E0502") || stderr.contains("E0505") {
        categories.push(ErrorCategory::RustBorrowCheck);
    }

    if stderr.contains("Cannot find module") || stderr.contains("ENOENT") {
        categories.push(ErrorCategory::NpmDependency);
    }

    if stderr.contains("TS2304") || stderr.contains("TS2345") || stderr.contains("TS2322") {
        categories.push(ErrorCategory::NpmTypeScript);
    }

    if categories.is_empty()
        && (stderr.contains("expected") || stderr.contains("syntax error") || stderr.contains("parse error"))
    {
        categories.push(ErrorCategory::GenericSyntax);
    }

    if categories.is_empty() {
        categories.push(ErrorCategory::Unknown);
    }
    categories
}

pub(crate) fn error_category_guidance(categories: &[ErrorCategory]) -> String {
    let mut guidance = String::new();
    for cat in categories {
        let advice: &str = match cat {
            ErrorCategory::RustStringLiteral => concat!(
                "DIAGNOSIS: Rust string literal / token errors detected.\n",
                "ROOT CAUSE: This almost always means JSON or text with special characters ",
                "was placed directly in Rust source code without proper string escaping.\n",
                "MANDATORY FIX:\n",
                "- For test fixtures or multi-line strings containing JSON, quotes, backslashes, ",
                "or special chars: use Rust RAW STRING LITERALS (r followed by # then quote to open, ",
                "quote then # to close; add more # symbols if the content itself contains that pattern).\n",
                "- For programmatic JSON construction: use serde_json::json!() macro instead of string literals.\n",
                "- NEVER put literal backslash-n (two characters) inside a Rust string to represent a newline; ",
                "use actual newlines inside raw strings, or proper escape sequences inside regular strings.\n",
                "- NEVER use non-ASCII characters (em dashes, smart quotes, etc.) in Rust string literals; ",
                "replace with ASCII equivalents.\n",
                "- Check ALL string literals in the file, not just the ones the compiler flagged -- ",
                "the same mistake is likely repeated.",
            ),
            ErrorCategory::RustMissingModule => concat!(
                "DIAGNOSIS: Missing Rust module file.\n",
                "FIX: If mod.rs or lib.rs declares `pub mod foo;`, the file `foo.rs` ",
                "(or `foo/mod.rs`) MUST exist. Either create the file or remove the module declaration.",
            ),
            ErrorCategory::RustMissingMethod => concat!(
                "DIAGNOSIS: Method not found on type.\n",
                "FIX: Check the actual public API of the type (read its source file). ",
                "Do not invent methods. If the method does not exist, either implement it ",
                "or use an existing method that provides the same functionality.",
            ),
            ErrorCategory::RustTypeError => concat!(
                "DIAGNOSIS: Type mismatch or missing trait implementation.\n",
                "FIX: Read the function signatures carefully. Check generic type parameters. ",
                "Provide explicit type annotations where the compiler asks for them. ",
                "Do not use `[u8]` where `Vec<u8>` or `&[u8]` is needed.",
            ),
            ErrorCategory::RustBorrowCheck => concat!(
                "DIAGNOSIS: Borrow checker violation.\n",
                "FIX: Check ownership and lifetimes. Consider cloning, using references, ",
                "or restructuring to avoid simultaneous mutable/immutable borrows.",
            ),
            ErrorCategory::RustStructFieldMismatch => concat!(
                "DIAGNOSIS: Struct field mismatch -- fields were added, removed, or renamed.\n",
                "FIX: Read the actual struct definition in the 'Actual API Reference' section below. ",
                "Update every initializer and field access to match the current struct fields exactly. ",
                "Add any new required fields (use Default/None for Option types), remove fields that ",
                "no longer exist, and rename fields that were renamed.\n",
            ),
            ErrorCategory::RustApiHallucination => concat!(
                "DIAGNOSIS: Systematic API hallucination detected -- your code assumes an API ",
                "that does not exist.\n",
                "ROOT CAUSE: You are calling multiple methods or using fields that are not part ",
                "of the actual type's public API.\n",
                "MANDATORY FIX:\n",
                "- The actual API is shown in the \"Actual API Reference\" section below.\n",
                "- Rewrite ALL calls to use ONLY the methods and fields listed there.\n",
                "- Do NOT invent, guess, or assume method names -- use exactly what exists.\n",
                "- If the functionality you need does not exist in the current API, implement it ",
                "or find an alternative approach.",
            ),
            ErrorCategory::NpmDependency => concat!(
                "DIAGNOSIS: Missing npm package or module.\n",
                "FIX: Ensure the dependency exists in package.json and has been installed. ",
                "Check import paths for typos.",
            ),
            ErrorCategory::NpmTypeScript => concat!(
                "DIAGNOSIS: TypeScript type errors.\n",
                "FIX: Check that types align with the library's actual API. ",
                "Read type definitions if needed.",
            ),
            ErrorCategory::GenericSyntax => concat!(
                "DIAGNOSIS: Syntax error.\n",
                "FIX: Look at the exact line/column the compiler indicates. ",
                "Check for missing semicolons, unbalanced braces, or misplaced tokens.",
            ),
            ErrorCategory::Unknown => "",
        };
        if !advice.is_empty() {
            guidance.push_str(advice);
            guidance.push_str("\n\n");
        }
    }
    guidance
}

pub(crate) fn parse_error_references(stderr: &str) -> file_ops::ErrorReferences {
    use regex::Regex;

    let mut refs = file_ops::ErrorReferences::default();

    let type_re = Regex::new(r"found for (?:struct|enum|trait|union) `(\w+)").unwrap();
    for cap in type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let init_type_re = Regex::new(r"in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in init_type_re.captures_iter(stderr) {
        let name = cap[1].to_string();
        if !refs.types_referenced.contains(&name) {
            refs.types_referenced.push(name);
        }
    }

    let method_re =
        Regex::new(r"no method named `(\w+)` found for (?:\w+ )?`(?:&(?:mut )?)?(\w+)").unwrap();
    for cap in method_re.captures_iter(stderr) {
        let method = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.methods_not_found
            .push((type_name.clone(), method));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let field_re =
        Regex::new(r"missing field `(\w+)` in initializer of `(?:\w+::)*(\w+)`").unwrap();
    for cap in field_re.captures_iter(stderr) {
        let field = cap[1].to_string();
        let type_name = cap[2].to_string();
        refs.missing_fields.push((type_name.clone(), field));
        if !refs.types_referenced.contains(&type_name) {
            refs.types_referenced.push(type_name);
        }
    }

    let loc_re = Regex::new(r"-->\s*([\w\\/._-]+):(\d+):\d+").unwrap();
    for cap in loc_re.captures_iter(stderr) {
        let file = cap[1].to_string();
        let line: u32 = cap[2].parse().unwrap_or(0);
        if !refs.source_locations.iter().any(|(f, l)| f == &file && *l == line) {
            refs.source_locations.push((file, line));
        }
    }

    let arg_re = Regex::new(r"takes (\d+) arguments? but (\d+)").unwrap();
    for cap in arg_re.captures_iter(stderr) {
        refs.wrong_arg_counts
            .push(format!("expected {} got {}", &cap[1], &cap[2]));
    }

    refs
}
