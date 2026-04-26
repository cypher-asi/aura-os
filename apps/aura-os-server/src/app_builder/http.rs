pub(super) fn resolve_local_server_base_url() -> String {
    aura_os_integrations::control_plane_api_base_url()
}

pub(super) fn build_local_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(3))
        .build()
        .expect("failed to build local HTTP client")
}
