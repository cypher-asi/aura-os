use super::*;

/// Build the [`aura_os_browser::BrowserManager`] using the real Chromium
/// CDP backend when the `cdp` feature is enabled, falling back to the
/// stub backend otherwise. The CDP backend launches Chromium lazily on
/// first use, so a missing executable only surfaces on first spawn.
pub(super) fn build_browser_manager(
    settings_root: PathBuf,
) -> Arc<aura_os_browser::BrowserManager> {
    let config = aura_os_browser::BrowserConfig::default().with_settings_root(settings_root);

    #[cfg(feature = "browser-cdp")]
    {
        let cdp_config = aura_os_browser::CdpBackendConfig::from_env();
        info!(
            sandbox_disabled = cdp_config.disable_sandbox,
            "browser: initialising CDP backend (Chromium launched lazily)"
        );
        return Arc::new(aura_os_browser::BrowserManager::with_backend(
            config,
            Arc::new(aura_os_browser::CdpBackend::with_config(cdp_config)),
        ));
    }
    #[allow(unreachable_code)]
    {
        info!("browser: using stub backend (enable the `browser-cdp` feature for real rendering)");
        Arc::new(aura_os_browser::BrowserManager::new(config))
    }
}
