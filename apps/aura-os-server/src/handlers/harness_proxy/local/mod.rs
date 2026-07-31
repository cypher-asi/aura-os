//! Skills management on the local machine. Implements the
//! `POST /api/harness/skills`, `DELETE /api/harness/skills/{name}` etc.
//! routes that aren't pure proxies — they read/write
//! `~/.aura/skills/<name>/SKILL.md` directly.
//!
//! Sub-modules:
//!
//! * [`frontmatter`] — YAML frontmatter parsing and escaping helpers.
//! * [`create`] — create-skill and install-from-shop flows.
//! * [`discover`] — read-only skill content / on-disk discovery.
//! * [`manage`] — list user-created skills and delete them.
//! * [`update`] — rewrite an existing user-created skill's SKILL.md.

mod create;
mod discover;
mod frontmatter;
mod manage;
mod migrate;
mod sync;
mod update;

pub(crate) use create::{
    create_skill, create_skill_from_payload_synced, install_from_shop, CreateSkillBody,
};
pub(crate) use discover::{discover_skill_paths, get_skill_content};
pub(crate) use manage::{delete_my_skill, get_my_skill, list_my_skills};
pub(crate) use migrate::repair_user_created_skill_names;
pub(crate) use sync::{adopt_installed_legacy_skill, cloud_skill_metadata_for_name};
pub(crate) use sync::{find_cloud_skill_by_name, materialize_cloud_skill, sync_all_cloud_skills};
pub(crate) use update::{update_my_skill, update_my_skill_from_payload_synced, UpdateSkillBody};

/// Marker written into the YAML frontmatter of every skill created via the
/// `POST /api/harness/skills` endpoint. Used by `list_my_skills` to separate
/// user-authored skills from shop-installed skills (both live under
/// ~/.aura/skills/ on disk).
pub(crate) const USER_CREATED_SOURCE_MARKER: &str = "user-created";

/// Path to the user's per-channel skills tree (`~/<channel>/skills`). Returns
/// `None` if the home directory cannot be resolved. Stable channel uses
/// `~/.aura/skills`; dev channel uses `~/.aura-dev/skills` so a dev build
/// cannot mutate the skills the installed stable build relies on.
pub(crate) fn user_skills_root() -> Option<std::path::PathBuf> {
    let home = dirs::home_dir()?;
    Some(
        home.join(aura_os_core::Channel::current().skills_home_name())
            .join("skills"),
    )
}

/// Returns `true` iff `<skills_root>/<name>/SKILL.md` exists. Used by the
/// catalog proxy in `list_skills` to hide skills the user has deleted even
/// when the harness hasn't rescanned its catalog yet.
pub(crate) fn skill_exists_on_disk(name: &str) -> bool {
    let Some(root) = user_skills_root() else {
        return false;
    };
    root.join(name).join("SKILL.md").exists()
}

pub(super) fn create_skill_name_valid(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    let is_alphanumeric = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();

    name.len() <= 64
        && is_alphanumeric(first)
        && name.chars().last().is_some_and(is_alphanumeric)
        && chars.all(|c| is_alphanumeric(c) || c == '-')
}

pub(super) fn skills_base_dir() -> std::path::PathBuf {
    std::env::var("SKILLS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("skills"))
}

#[cfg(test)]
mod tests {
    use super::create_skill_name_valid;

    #[test]
    fn skill_names_match_canonical_storage_constraints() {
        for valid in ["a", "skill-1", "1-skill", &"a".repeat(64)] {
            assert!(create_skill_name_valid(valid), "{valid:?} should be valid");
        }

        for invalid in [
            "",
            "-skill",
            "skill-",
            "Skill",
            "skill_name",
            "skill name",
            &"a".repeat(65),
        ] {
            assert!(
                !create_skill_name_valid(invalid),
                "{invalid:?} should be invalid"
            );
        }
    }
}
