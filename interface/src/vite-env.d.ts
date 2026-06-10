interface ImportMetaEnv {
  readonly VITE_NATIVE_DEFAULT_HOST?: string;
  readonly VITE_ANDROID_DEFAULT_HOST?: string;
  readonly VITE_IOS_DEFAULT_HOST?: string;
  readonly VITE_ENABLE_SETTINGS_PROVIDER_SELECTION?: string;
  // Temporarily gates the marketing top-nav "Expertise" dropdown. Hidden
  // unless this is set to a truthy value (1/true/yes/on).
  readonly VITE_ENABLE_MARKETING_EXPERTISE?: string;
  readonly VITE_DEFAULT_INVITE_CODE?: string;
  readonly VITE_MIXPANEL_TOKEN?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
  // Marketing pages (Phase 1 port from aura-web). Optional override for the
  // changelog index location; falls back to the public GitHub Pages index
  // when unset. The marketing Feedback list reads from the main server's
  // `/api/public/feedback` pass-through, so no browser-side aura-network
  // URL is required.
  readonly VITE_CHANGELOG_INDEX_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILD_TIME__: string;
declare const __APP_CHANNEL__: string;

interface Window {
  __AURA_BOOT_STATUS__?: {
    mark?: (phase: string) => void;
    fail?: (message: string, detail?: string) => void;
    clear?: () => void;
  };
}
