use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use tracing::warn;

const SETTINGS_FILE_NAME: &str = "desktop-route.json";

#[derive(Clone)]
pub(crate) struct RouteState {
    route: Arc<RwLock<Option<String>>>,
    settings_path: Arc<PathBuf>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedRouteSettings {
    route: String,
}

impl RouteState {
    pub(crate) fn load(data_dir: &Path) -> Self {
        let settings_path = data_dir.join(SETTINGS_FILE_NAME);
        let route = load_persisted_route(&settings_path).unwrap_or_else(|error| {
            warn!(
                error = %error,
                path = %settings_path.display(),
                "failed to load persisted desktop route"
            );
            None
        });

        Self {
            route: Arc::new(RwLock::new(route)),
            settings_path: Arc::new(settings_path),
        }
    }

    pub(crate) fn current_route(&self) -> Option<String> {
        self.route
            .read()
            .expect("desktop route lock poisoned")
            .clone()
    }

    pub(crate) fn persist_route(&self, route: &str) -> Result<String, String> {
        let normalized = normalize_restore_route(route)
            .ok_or_else(|| format!("invalid desktop restore route: {route}"))?;

        persist_route(self.settings_path.as_ref(), &normalized)?;
        *self.route.write().expect("desktop route lock poisoned") = Some(normalized.clone());
        Ok(normalized)
    }
}

fn load_persisted_route(settings_path: &Path) -> Result<Option<String>, String> {
    if !settings_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(settings_path).map_err(|error| {
        format!(
            "failed to read desktop route settings {}: {error}",
            settings_path.display()
        )
    })?;

    let settings: PersistedRouteSettings = serde_json::from_slice(&bytes).map_err(|error| {
        format!(
            "failed to parse desktop route settings {}: {error}",
            settings_path.display()
        )
    })?;

    normalize_restore_route(&settings.route)
        .ok_or_else(|| format!("invalid desktop route in {}", settings_path.display()))
        .map(Some)
}

fn persist_route(settings_path: &Path, route: &str) -> Result<(), String> {
    if let Some(parent) = settings_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create desktop route settings directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let payload = serde_json::to_vec_pretty(&PersistedRouteSettings {
        route: route.to_string(),
    })
    .map_err(|error| format!("failed to encode desktop route settings: {error}"))?;

    fs::write(settings_path, payload).map_err(|error| {
        format!(
            "failed to write desktop route settings {}: {error}",
            settings_path.display()
        )
    })
}

pub(crate) fn normalize_restore_route(route: &str) -> Option<String> {
    let trimmed = route.trim();
    if trimmed.is_empty() {
        return None;
    }

    let (without_hash, hash) = match trimmed.split_once('#') {
        Some((value, fragment)) => (value, Some(fragment)),
        None => (trimmed, None),
    };
    let (path, query) = match without_hash.split_once('?') {
        Some((value, search)) => (value, Some(search)),
        None => (without_hash, None),
    };

    if !is_valid_restore_path(path) {
        return None;
    }

    let mut normalized = path.to_string();
    let filtered_query = query
        .map(|search| {
            search
                .split('&')
                .filter(|segment| !segment.trim().is_empty())
                .filter(|segment| {
                    let key = segment
                        .split_once('=')
                        .map(|(name, _)| name)
                        .unwrap_or(*segment);
                    !key.eq_ignore_ascii_case("host")
                })
                .collect::<Vec<_>>()
                .join("&")
        })
        .filter(|search| !search.is_empty());

    if let Some(search) = filtered_query {
        normalized.push('?');
        normalized.push_str(&search);
    }
    if let Some(fragment) = hash.filter(|value| !value.is_empty()) {
        normalized.push('#');
        normalized.push_str(fragment);
    }

    Some(normalized)
}

fn is_valid_restore_path(path: &str) -> bool {
    path.starts_with('/')
        && path != "/"
        && path != "/login"
        && path != "/health"
        && path != "/api"
        && !path.starts_with("/api/")
        && path != "/ws"
        && !path.starts_with("/ws/")
        && !path.starts_with("/desktop")
}

#[cfg(test)]
mod tests {
    use super::normalize_restore_route;

    #[test]
    fn normalizes_valid_routes_and_strips_host_query() {
        assert_eq!(
            normalize_restore_route("/projects/demo?session=abc&host=http://127.0.0.1:19847#pane"),
            Some("/projects/demo?session=abc#pane".to_string())
        );
    }

    #[test]
    fn rejects_invalid_restore_targets() {
        assert_eq!(normalize_restore_route("/"), None);
        assert_eq!(normalize_restore_route("/login"), None);
        assert_eq!(normalize_restore_route("/desktop"), None);
        assert_eq!(normalize_restore_route("/api/runtime-config"), None);
        assert_eq!(normalize_restore_route("projects/demo"), None);
    }
}
