function normalizeExternalLink(value: string | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!["http:", "https:", "mailto:"].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function getPrivacyPolicyUrl(): string | null {
  return normalizeExternalLink(import.meta.env.VITE_PRIVACY_POLICY_URL);
}

export function getSupportUrl(): string | null {
  return normalizeExternalLink(import.meta.env.VITE_SUPPORT_URL);
}
