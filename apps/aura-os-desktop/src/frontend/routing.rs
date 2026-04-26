//! URL stitching used by the desktop binary to swap between the bundled
//! axum-served frontend and a live Vite dev server while preserving the
//! query string, route restoration target, and `host` parameter.

use crate::frontend::config::{FrontendDevServerCandidate, FrontendTarget};
use crate::route_state::normalize_restore_route;

pub(crate) fn append_query_param(url: &str, key: &str, value: &str) -> String {
    let separator = if url.contains('?') { '&' } else { '?' };
    format!("{}{separator}{key}={value}", url.trim_end_matches('/'))
}

pub(crate) fn build_frontend_dev_server_candidate(
    server_url: &str,
    frontend_dev_url: &str,
) -> FrontendDevServerCandidate {
    FrontendDevServerCandidate {
        probe_url: frontend_dev_url.to_string(),
        frontend_url: append_query_param(frontend_dev_url, "host", server_url),
    }
}

pub(crate) fn apply_restore_route(base_url: &str, restore_route: Option<&str>) -> String {
    let Some(route) = restore_route.and_then(normalize_restore_route) else {
        return base_url.to_string();
    };

    let (route_without_hash, route_hash) = match route.split_once('#') {
        Some((value, fragment)) => (value, Some(fragment)),
        None => (route.as_str(), None),
    };
    let (route_path, route_query) = match route_without_hash.split_once('?') {
        Some((value, query)) => (value, Some(query)),
        None => (route_without_hash, None),
    };
    let (base_without_hash, base_hash) = match base_url.split_once('#') {
        Some((value, fragment)) => (value, Some(fragment)),
        None => (base_url, None),
    };
    let (base_without_query, base_query) = match base_without_hash.split_once('?') {
        Some((value, query)) => (value, Some(query)),
        None => (base_without_hash, None),
    };

    let mut url = format!("{}{}", base_without_query.trim_end_matches('/'), route_path);
    let mut query_parts = Vec::new();
    if let Some(query) = route_query.filter(|value| !value.is_empty()) {
        query_parts.push(query);
    }
    if let Some(query) = base_query.filter(|value| !value.is_empty()) {
        query_parts.push(query);
    }

    if !query_parts.is_empty() {
        url.push('?');
        url.push_str(&query_parts.join("&"));
    }

    if let Some(fragment) = route_hash
        .filter(|value| !value.is_empty())
        .or(base_hash.filter(|value| !value.is_empty()))
    {
        url.push('#');
        url.push_str(fragment);
    }

    url
}

pub(crate) fn resolve_frontend_target_with_probe(
    server_url: &str,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
    frontend_dev_server_available: bool,
) -> FrontendTarget {
    match (frontend_dev_candidate, frontend_dev_server_available) {
        (Some(candidate), true) => {
            FrontendTarget::dev_server(server_url, candidate.frontend_url.clone())
        }
        _ => FrontendTarget::server(server_url),
    }
}

pub(crate) fn should_poll_for_frontend_dev_server(
    using_frontend_dev_server: bool,
    frontend_dev_candidate: Option<&FrontendDevServerCandidate>,
) -> bool {
    frontend_dev_candidate.is_some() && !using_frontend_dev_server
}

#[cfg(test)]
mod tests {
    use super::{
        append_query_param, apply_restore_route, build_frontend_dev_server_candidate,
        resolve_frontend_target_with_probe, should_poll_for_frontend_dev_server,
    };

    #[test]
    fn append_query_param_preserves_existing_query() {
        assert_eq!(
            append_query_param(
                "http://127.0.0.1:5173?foo=bar",
                "host",
                "http://127.0.0.1:19847",
            ),
            "http://127.0.0.1:5173?foo=bar&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn build_frontend_dev_server_candidate_preserves_existing_query() {
        let candidate = build_frontend_dev_server_candidate(
            "http://127.0.0.1:19847",
            "http://127.0.0.1:5173?foo=bar",
        );

        assert_eq!(candidate.probe_url, "http://127.0.0.1:5173?foo=bar");
        assert_eq!(
            candidate.frontend_url,
            "http://127.0.0.1:5173?foo=bar&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn apply_restore_route_preserves_route_query_and_base_query() {
        assert_eq!(
            apply_restore_route(
                "http://127.0.0.1:5173?host=http://127.0.0.1:19847",
                Some("/projects/demo?session=abc#panel"),
            ),
            "http://127.0.0.1:5173/projects/demo?session=abc&host=http://127.0.0.1:19847#panel"
        );
    }

    #[test]
    fn apply_restore_route_strips_host_from_saved_route() {
        assert_eq!(
            apply_restore_route(
                "http://127.0.0.1:5173?host=http://127.0.0.1:19847",
                Some("/projects/demo?session=abc&host=http://127.0.0.1:19847"),
            ),
            "http://127.0.0.1:5173/projects/demo?session=abc&host=http://127.0.0.1:19847"
        );
    }

    #[test]
    fn resolve_frontend_target_prefers_vite_when_available() {
        let server_url = "http://127.0.0.1:19847";
        let candidate = build_frontend_dev_server_candidate(server_url, "http://127.0.0.1:5173");

        let target = resolve_frontend_target_with_probe(server_url, Some(&candidate), true);

        assert_eq!(
            target.url,
            "http://127.0.0.1:5173?host=http://127.0.0.1:19847"
        );
        assert_eq!(target.host_origin.as_deref(), Some(server_url));
        assert!(target.using_frontend_dev_server);
    }

    #[test]
    fn resolve_frontend_target_falls_back_when_vite_unavailable() {
        let server_url = "http://127.0.0.1:19847";
        let candidate = build_frontend_dev_server_candidate(server_url, "http://127.0.0.1:5173");

        let target = resolve_frontend_target_with_probe(server_url, Some(&candidate), false);

        assert_eq!(target.url, server_url);
        assert_eq!(target.host_origin, None);
        assert!(!target.using_frontend_dev_server);
    }

    #[test]
    fn frontend_dev_server_poller_only_runs_when_needed() {
        let candidate =
            build_frontend_dev_server_candidate("http://127.0.0.1:19847", "http://127.0.0.1:5173");

        assert!(should_poll_for_frontend_dev_server(false, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(true, Some(&candidate)));
        assert!(!should_poll_for_frontend_dev_server(false, None));
    }
}
