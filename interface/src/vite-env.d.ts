interface ImportMetaEnv {
  readonly VITE_NATIVE_DEFAULT_HOST?: string;
  readonly VITE_ANDROID_DEFAULT_HOST?: string;
  readonly VITE_IOS_DEFAULT_HOST?: string;
  readonly VITE_ENABLE_SETTINGS_PROVIDER_SELECTION?: string;
  readonly VITE_DEFAULT_INVITE_CODE?: string;
  readonly VITE_MIXPANEL_TOKEN?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
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
