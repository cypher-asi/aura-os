interface ImportMetaEnv {
  readonly VITE_NATIVE_DEFAULT_HOST?: string;
  readonly VITE_ANDROID_DEFAULT_HOST?: string;
  readonly VITE_IOS_DEFAULT_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
