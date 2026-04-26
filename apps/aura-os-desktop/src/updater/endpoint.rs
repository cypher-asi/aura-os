//! Update endpoint URL construction and Minisign public key handling.

use base64::Engine;
use cargo_packager_updater::{
    semver::Version as SemverVersion, Config as PackagerUpdaterConfig, UpdaterBuilder,
    WindowsConfig, WindowsUpdateInstallMode,
};

use super::{UpdateChannel, CHECK_TIMEOUT};

// Base64-encoded Minisign public key baked in at compile time through build.rs.
const UPDATER_PUB_KEY: &str = env!("UPDATER_PUBLIC_KEY");

pub(crate) fn update_base_url() -> String {
    std::env::var("AURA_UPDATE_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            option_env!("AURA_UPDATE_BASE_URL")
                .unwrap_or("https://n3o.github.io/aura-app")
                .trim_end_matches('/')
                .to_string()
        })
}

pub(super) fn endpoint_for_channel_with_base(channel: UpdateChannel, base: &str) -> String {
    let chan = channel.as_str();
    format!("{base}/{chan}/{{{{target}}}}/{{{{arch}}}}.json")
}

pub(crate) fn endpoint_for_channel(channel: UpdateChannel) -> String {
    let base = update_base_url();
    endpoint_for_channel_with_base(channel, &base)
}

pub(super) fn validate_base64_utf8(label: &str, encoded: &str) -> Result<String, String> {
    let trimmed = encoded.trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|e| format!("invalid {label} base64: {e}"))?;
    String::from_utf8(decoded).map_err(|e| format!("invalid {label} utf-8: {e}"))?;
    Ok(trimmed.to_string())
}

fn updater_public_key() -> Result<String, String> {
    if UPDATER_PUB_KEY.starts_with("NOT_SET__") {
        return Err("updater public key is not configured".into());
    }
    // cargo-packager-updater expects the public key to remain base64-encoded.
    // We validate it here, but preserve the encoded value for the updater crate.
    validate_base64_utf8("public key", UPDATER_PUB_KEY)
}

pub(crate) fn updater_supported() -> bool {
    updater_public_key().is_ok()
}

fn updater_config(channel: UpdateChannel) -> Result<PackagerUpdaterConfig, String> {
    let endpoint = endpoint_for_channel(channel)
        .parse()
        .map_err(|e| format!("invalid updater endpoint: {e}"))?;
    Ok(PackagerUpdaterConfig {
        endpoints: vec![endpoint],
        pubkey: updater_public_key()?,
        windows: Some(WindowsConfig {
            install_mode: Some(WindowsUpdateInstallMode::Passive),
            installer_args: None,
        }),
    })
}

pub(super) fn build_updater(
    channel: UpdateChannel,
) -> Result<cargo_packager_updater::Updater, String> {
    let current_version = SemverVersion::parse(env!("CARGO_PKG_VERSION"))
        .map_err(|e| format!("invalid current version: {e}"))?;
    let config = updater_config(channel)?;
    UpdaterBuilder::new(current_version, config)
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| format!("failed to build updater: {e}"))
}
