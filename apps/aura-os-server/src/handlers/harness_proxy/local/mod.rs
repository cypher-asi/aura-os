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

mod create;
mod discover;
mod frontmatter;
mod manage;

pub(crate) use create::{create_skill, install_from_shop};
pub(crate) use discover::{discover_skill_paths, get_skill_content};
pub(crate) use manage::{delete_my_skill, list_my_skills};

/// Marker written into the YAML frontmatter of every skill created via the
/// `POST /api/harness/skills` endpoint. Used by `list_my_skills` to separate
/// user-authored skills from shop-installed skills (both live under
/// ~/.aura/skills/ on disk).
pub(crate) const USER_CREATED_SOURCE_MARKER: &str = "user-created";

/// Returns `true` iff `~/.aura/skills/<name>/SKILL.md` exists. Used by the
/// catalog proxy in `list_skills` to hide skills the user has deleted even
/// when the harness hasn't rescanned its catalog yet.
pub(crate) fn skill_exists_on_disk(name: &str) -> bool {
    let Some(home) = dirs::home_dir() else {
        return false;
    };
    home.join(".aura")
        .join("skills")
        .join(name)
        .join("SKILL.md")
        .exists()
}

pub(super) fn create_skill_name_valid(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

pub(super) fn skills_base_dir() -> std::path::PathBuf {
    std::env::var("SKILLS_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| std::path::PathBuf::from("skills"))
}
