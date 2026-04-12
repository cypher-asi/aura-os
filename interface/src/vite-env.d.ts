interface ImportMetaEnv {
  readonly VITE_NATIVE_DEFAULT_HOST?: string;
  readonly VITE_ANDROID_DEFAULT_HOST?: string;
  readonly VITE_IOS_DEFAULT_HOST?: string;
  readonly VITE_PRIVACY_POLICY_URL?: string;
  readonly VITE_SUPPORT_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
