//! Startup recovery for user-created skills written before the `name:`
//! frontmatter fix. A SKILL.md without `name:` fails to load into the harness
//! registry ("skill not found"), so this backfills the field — derived from
//! the skill's directory name — into any user-created skill missing it.
//! Idempotent and fail-soft; the harness picks the repaired files up on its
//! next reload (its startup, or the next skill create).

use std::path::Path;

use super::frontmatter::{extract_frontmatter_field, yaml_escape_scalar};
use super::{create_skill_name_valid, user_skills_root, USER_CREATED_SOURCE_MARKER};

/// Backfill `name:` into pre-fix user-created skills under the real skills
/// root. Safe no-op when the home/skills directory can't be resolved.
pub(crate) fn repair_user_created_skill_names() {
    if let Some(root) = user_skills_root() {
        let repaired = repair_skills_in(&root);
        if repaired > 0 {
            tracing::info!(
                repaired,
                "backfilled missing name: into user-created skill frontmatter"
            );
        }
    }
}

/// Core logic, parameterised on the skills root so it is unit-testable
/// without touching the real home directory. Returns the number of skills
/// repaired. Only rewrites user-created skills (carrying the
/// `source: "user-created"` marker) that lack a `name:` field — shop skills
/// and already-correct skills are left untouched.
fn repair_skills_in(root: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(root) else {
        return 0; // no skills directory yet — nothing to repair
    };
    let mut repaired = 0;
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        // Never invent an invalid name — the harness would reject it anyway.
        if !create_skill_name_valid(name) {
            continue;
        }
        let skill_md = dir.join("SKILL.md");
        let Ok(content) = std::fs::read_to_string(&skill_md) else {
            continue;
        };
        let is_user_created = extract_frontmatter_field(&content, "source").as_deref()
            == Some(USER_CREATED_SOURCE_MARKER);
        if !is_user_created || extract_frontmatter_field(&content, "name").is_some() {
            continue;
        }
        // Insert `name: "<dir>"` right after the opening delimiter so the
        // rewritten file matches what create/edit now emit.
        let Some(rest) = content.strip_prefix("---\n") else {
            continue; // not a frontmatter doc we recognise — leave it alone
        };
        let fixed = format!("---\nname: \"{}\"\n{rest}", yaml_escape_scalar(name));
        // Write atomically (temp + rename within the same directory) so the
        // harness can never read a half-written SKILL.md if it reloads during
        // a startup race. A leftover `.tmp` is invisible to the harness (it
        // reads `SKILL.md`); clean it up on the rare failure path anyway.
        let tmp = dir.join("SKILL.md.tmp");
        if std::fs::write(&tmp, &fixed).is_ok() && std::fs::rename(&tmp, &skill_md).is_ok() {
            repaired += 1;
        } else {
            let _ = std::fs::remove_file(&tmp);
        }
    }
    repaired
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_skill(root: &Path, name: &str, frontmatter: &str) {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("SKILL.md"), frontmatter).unwrap();
    }

    fn read_skill(root: &Path, name: &str) -> String {
        std::fs::read_to_string(root.join(name).join("SKILL.md")).unwrap()
    }

    #[test]
    fn backfills_name_into_user_created_skill_missing_it() {
        let tmp = tempfile::tempdir().unwrap();
        write_skill(
            tmp.path(),
            "my-skill",
            "---\ndescription: \"x\"\nuser_invocable: true\nsource: \"user-created\"\n---\nbody\n",
        );

        assert_eq!(repair_skills_in(tmp.path()), 1);

        let fixed = read_skill(tmp.path(), "my-skill");
        assert!(
            fixed.starts_with("---\nname: \"my-skill\"\n"),
            "name should be inserted right after the opening delimiter, got:\n{fixed}"
        );
        // Original content preserved.
        assert!(fixed.contains("description: \"x\""));
        assert!(fixed.contains("source: \"user-created\""));
        assert!(fixed.contains("body"));

        // Idempotent — a second pass changes nothing.
        assert_eq!(repair_skills_in(tmp.path()), 0);
    }

    #[test]
    fn leaves_name_bearing_skills_untouched() {
        let tmp = tempfile::tempdir().unwrap();
        let original =
            "---\nname: \"already-named\"\ndescription: \"x\"\nsource: \"user-created\"\n---\nbody\n";
        write_skill(tmp.path(), "already-named", original);

        assert_eq!(repair_skills_in(tmp.path()), 0);
        assert_eq!(read_skill(tmp.path(), "already-named"), original);
    }

    #[test]
    fn ignores_skills_without_the_user_created_marker() {
        let tmp = tempfile::tempdir().unwrap();
        // A shop-installed skill without our marker must not be rewritten.
        let original = "---\ndescription: \"from shop\"\n---\nbody\n";
        write_skill(tmp.path(), "shop-skill", original);

        assert_eq!(repair_skills_in(tmp.path()), 0);
        assert_eq!(read_skill(tmp.path(), "shop-skill"), original);
    }

    #[test]
    fn skips_invalid_directory_names() {
        let tmp = tempfile::tempdir().unwrap();
        let original = "---\ndescription: \"x\"\nsource: \"user-created\"\n---\nbody\n";
        write_skill(tmp.path(), "Bad_Name", original); // uppercase + underscore

        assert_eq!(repair_skills_in(tmp.path()), 0);
        assert_eq!(read_skill(tmp.path(), "Bad_Name"), original);
    }
}
