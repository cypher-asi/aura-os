use super::*;

pub(super) fn spawn_health_checks(
    storage_client: &Option<Arc<StorageClient>>,
    network_client: &Option<Arc<NetworkClient>>,
    integrations_client: &Option<Arc<IntegrationsClient>>,
) {
    if let Some(ref client) = storage_client {
        if client.has_internal_token() {
            info!("aura-storage internal token configured; remote process proxy is enabled");
        } else {
            info!(
                "aura-storage is configured without AURA_STORAGE_INTERNAL_TOKEN; process CRUD remains available through user JWTs"
            );
        }
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(()) => info!("aura-storage is reachable"),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-storage health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!("aura-storage integration disabled (AURA_STORAGE_URL not set)");
    }

    if let Some(ref client) = network_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(h) => info!(
                    status = %h.status,
                    version = h.version.as_deref().unwrap_or("unknown"),
                    "aura-network is reachable"
                ),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-network health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!("aura-network integration disabled (AURA_NETWORK_URL not set)");
    }

    if let Some(ref client) = integrations_client {
        let health_client = client.clone();
        tokio::spawn(async move {
            match health_client.health_check().await {
                Ok(()) => info!("aura-integrations is reachable and serving as the canonical integration backend"),
                Err(e) => tracing::warn!(
                    error = %e,
                    "aura-integrations health check failed on startup (will retry on first request)"
                ),
            }
        });
    } else {
        info!(
            "aura-integrations is not configured; Aura OS will use compatibility-only local integration storage"
        );
    }
}
