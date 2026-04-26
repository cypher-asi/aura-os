//! Webview boot bootstrap: the JavaScript blob the desktop shell injects
//! before any frontend code runs, plus the cached-auth snapshot pulled out
//! of `aura_os_store::SettingsStore` that the blob bakes in.
//!
//! See `interface/src/lib/auth-token.ts::readBootInjectedAuth()` for the
//! consumer side of the `__AURA_BOOT_AUTH__` global produced here.

use aura_os_store::SettingsStore;
use std::path::Path;
use tracing::warn;

pub(crate) const HOST_STORAGE_KEY: &str = "aura-host-origin";
pub(crate) const SESSION_STORAGE_KEY: &str = "aura-session";
pub(crate) const JWT_STORAGE_KEY: &str = "aura-jwt";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct BootstrappedAuthLiterals {
    pub(crate) session_literal: String,
    pub(crate) jwt_literal: String,
}

pub(crate) fn load_bootstrapped_auth_literals(
    store_path: &Path,
) -> Option<BootstrappedAuthLiterals> {
    let store = match SettingsStore::open(store_path) {
        Ok(store) => store,
        Err(error) => {
            warn!(
                %error,
                path = %store_path.display(),
                "failed to open settings store for desktop auth bootstrap"
            );
            return None;
        }
    };
    let session = store.get_cached_zero_auth_session()?;
    let session_literal = match serde_json::to_string(&session) {
        Ok(value) => value,
        Err(error) => {
            warn!(%error, "failed to serialize cached desktop auth session");
            return None;
        }
    };
    let jwt_literal = match serde_json::to_string(&session.access_token) {
        Ok(value) => value,
        Err(error) => {
            warn!(%error, "failed to serialize cached desktop auth token");
            return None;
        }
    };
    Some(BootstrappedAuthLiterals {
        session_literal,
        jwt_literal,
    })
}

pub(crate) fn build_initialization_script(
    host_origin: Option<&str>,
    bootstrapped_auth: Option<&BootstrappedAuthLiterals>,
) -> String {
    let mut statements = Vec::new();

    if let Some(origin) = host_origin {
        let host_literal = serde_json::to_string(origin)
            .expect("failed to serialize host origin for initialization script");
        statements.push(format!(
            "window.localStorage.setItem('{HOST_STORAGE_KEY}', {host_literal});"
        ));
    }

    // Inject an explicit, frozen boot-auth global read by the frontend at
    // module load (before any localStorage parsing). This is the canonical
    // "is the user logged in?" signal on desktop: it comes straight from the
    // on-disk SettingsStore via `load_bootstrapped_auth_literals`, so it is
    // authoritative even if the webview's localStorage is stale or has not
    // yet been hydrated from IndexedDB. See
    // `interface/src/lib/auth-token.ts::readBootInjectedAuth()`.
    let (boot_auth_is_logged_in, boot_auth_session, boot_auth_jwt) = match bootstrapped_auth {
        Some(auth) => (
            "true",
            auth.session_literal.as_str(),
            auth.jwt_literal.as_str(),
        ),
        None => ("false", "null", "null"),
    };
    statements.push(format!(
        "Object.defineProperty(window, '__AURA_BOOT_AUTH__', {{ \
            value: Object.freeze({{ isLoggedIn: {boot_auth_is_logged_in}, session: {boot_auth_session}, jwt: {boot_auth_jwt} }}), \
            configurable: false, \
            writable: false, \
            enumerable: false \
        }});"
    ));

    // Mirror the boot auth into localStorage too — the rest of the frontend
    // (API clients reading JWT on demand, IndexedDB hydration, etc.) still
    // treats localStorage as the canonical session mirror post-boot.
    if let Some(auth) = bootstrapped_auth {
        statements.push(format!(
            "window.localStorage.setItem('{SESSION_STORAGE_KEY}', {});",
            auth.session_literal
        ));
        statements.push(format!(
            "window.localStorage.setItem('{JWT_STORAGE_KEY}', {});",
            auth.jwt_literal
        ));
    }

    if statements.is_empty() {
        String::new()
    } else {
        format!("try {{ {} }} catch {{}};", statements.join(" "))
    }
}

#[cfg(test)]
mod tests {
    use super::{build_initialization_script, BootstrappedAuthLiterals};

    #[test]
    fn build_initialization_script_persists_host_origin() {
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), None);
        assert!(script.contains("aura-host-origin"));
        assert!(script.contains("http://127.0.0.1:19847"));
        assert!(!script.contains("window.ipc.postMessage('ready')"));
    }

    #[test]
    fn build_initialization_script_bootstraps_cached_auth() {
        let auth = BootstrappedAuthLiterals {
            session_literal:
                "{\"user_id\":\"u1\",\"display_name\":\"Test\",\"access_token\":\"jwt\"}"
                    .to_string(),
            jwt_literal: "\"jwt\"".to_string(),
        };
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), Some(&auth));
        assert!(script.contains("aura-session"));
        assert!(script.contains("aura-jwt"));
        assert!(script.contains("\"jwt\""));
    }

    #[test]
    fn build_initialization_script_injects_boot_auth_global_when_logged_in() {
        let auth = BootstrappedAuthLiterals {
            session_literal:
                "{\"user_id\":\"u1\",\"display_name\":\"Test\",\"access_token\":\"jwt\"}"
                    .to_string(),
            jwt_literal: "\"jwt\"".to_string(),
        };
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), Some(&auth));
        assert!(script.contains("__AURA_BOOT_AUTH__"));
        assert!(script.contains("isLoggedIn: true"));
        assert!(script.contains("\"user_id\":\"u1\""));
        assert!(script.contains("Object.freeze"));
    }

    #[test]
    fn build_initialization_script_injects_boot_auth_global_when_logged_out() {
        let script = build_initialization_script(Some("http://127.0.0.1:19847"), None);
        assert!(script.contains("__AURA_BOOT_AUTH__"));
        assert!(script.contains("isLoggedIn: false"));
        assert!(script.contains("session: null"));
        assert!(script.contains("jwt: null"));
    }
}
