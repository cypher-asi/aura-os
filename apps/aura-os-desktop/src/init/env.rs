//! Environment-variable helpers and runtime defaults.
//!
//! Centralises three concerns kept together so the desktop binary's startup
//! pipeline reads as a single decision tree rather than scattered `std::env`
//! calls:
//!
//! - lookups (`env_string`, `env_flag_enabled`, `ci_mode_enabled`)
//! - mutating defaults (`set_env_default`, `apply_desktop_runtime_defaults`)
//! - the compile-time fallbacks emitted by `build.rs`

pub(crate) fn ci_mode_enabled() -> bool {
    std::env::var("AURA_DESKTOP_CI")
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

pub(crate) fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .is_some_and(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
}

pub(crate) fn env_string(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn set_env_default(name: &str, value: &'static str) {
    if std::env::var_os(name).is_none() && !value.trim().is_empty() {
        std::env::set_var(name, value);
    }
}

pub(crate) fn apply_desktop_runtime_defaults() {
    set_env_default(
        "AURA_NETWORK_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_NETWORK_URL"),
    );
    set_env_default(
        "AURA_STORAGE_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_STORAGE_URL"),
    );
    set_env_default(
        "AURA_INTEGRATIONS_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_INTEGRATIONS_URL"),
    );
    set_env_default(
        "AURA_ROUTER_URL",
        env!("AURA_DESKTOP_DEFAULT_AURA_ROUTER_URL"),
    );
    set_env_default("Z_BILLING_URL", env!("AURA_DESKTOP_DEFAULT_Z_BILLING_URL"));
    set_env_default(
        "ORBIT_BASE_URL",
        env!("AURA_DESKTOP_DEFAULT_ORBIT_BASE_URL"),
    );
    set_env_default(
        "SWARM_BASE_URL",
        env!("AURA_DESKTOP_DEFAULT_SWARM_BASE_URL"),
    );
    set_env_default(
        "REQUIRE_ZERO_PRO",
        env!("AURA_DESKTOP_DEFAULT_REQUIRE_ZERO_PRO"),
    );
    set_env_default(
        "Z_BILLING_API_KEY",
        env!("AURA_DESKTOP_DEFAULT_Z_BILLING_API_KEY"),
    );
    set_env_default(
        "AURA_DISABLE_LOCAL_HARNESS_AUTOSPAWN",
        env!("AURA_DESKTOP_DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN"),
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn desktop_runtime_defaults_include_hosted_services() {
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_NETWORK_URL"),
            "https://aura-network.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_STORAGE_URL"),
            "https://aura-storage.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_INTEGRATIONS_URL"),
            "https://aura-integrations.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_AURA_ROUTER_URL"),
            "https://aura-router.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_Z_BILLING_URL"),
            "https://z-billing.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_ORBIT_BASE_URL"),
            "https://orbit-sfvu.onrender.com"
        );
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_SWARM_BASE_URL"),
            "http://ab6d2375031e74ce1976fdf62ea951a4-e757483aaffba396.elb.us-east-2.amazonaws.com"
        );
        assert_eq!(env!("AURA_DESKTOP_DEFAULT_REQUIRE_ZERO_PRO"), "false");
        assert_eq!(
            env!("AURA_DESKTOP_DEFAULT_DISABLE_LOCAL_HARNESS_AUTOSPAWN"),
            "true"
        );
    }
}
