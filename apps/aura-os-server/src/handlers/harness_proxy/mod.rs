//! HTTP proxy and helpers for harness-backed routes (`/api/harness/*`).

mod access;
mod local;
mod memory;
mod skills;

pub(crate) use access::require_agent_proxy_access;
pub(crate) use local::{
    create_skill, create_skill_from_payload, delete_my_skill, discover_skill_paths, get_my_skill,
    get_skill_content, install_from_shop, list_my_skills, repair_user_created_skill_names,
    skill_exists_on_disk, update_my_skill, update_my_skill_from_payload, CreateSkillBody,
    UpdateSkillBody,
};
pub(crate) use memory::{
    create_event, create_fact, create_procedure, delete_event, delete_fact, delete_procedure,
    get_continuity_config, get_fact, get_fact_by_key, get_latest_retrieval_trace,
    get_memory_snapshot, get_memory_stats, get_procedure, list_events, list_facts, list_procedures,
    list_procedures_by_skill, trigger_consolidation, update_continuity_config, update_fact,
    update_procedure, wipe_memory,
};
pub(crate) use skills::{
    activate_skill, get_skill, install_agent_skill, list_agent_skills, list_skills,
    uninstall_agent_skill,
};
