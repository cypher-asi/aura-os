export function isSettingsProviderSelectionEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_SETTINGS_PROVIDER_SELECTION?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function isMarketingExpertiseEnabled(): boolean {
  const raw = import.meta.env.VITE_ENABLE_MARKETING_EXPERTISE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
