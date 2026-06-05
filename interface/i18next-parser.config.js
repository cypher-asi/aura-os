// Extracts `t("key")` usages into the English source catalogs under
// src/locales/en/<namespace>.json so the key inventory stays in sync as
// more of the app is migrated to i18n. Run with:
//   npx i18next-parser --config i18next-parser.config.js
//
// Other locales mirror the en keys; missing keys fall back to en at
// runtime (see src/i18n/index.ts), so this never overwrites translations.
export default {
  locales: [
    "en",
    "es",
    "fr",
    "de",
    "pt-BR",
    "it",
    "ru",
    "zh-Hans",
    "zh-Hant",
    "ja",
    "ko",
    "ar",
    "hi",
    "nl",
    "pl",
    "tr",
    "vi",
    "id",
    "th",
    "uk",
  ],
  defaultNamespace: "common",
  namespaceSeparator: ":",
  keySeparator: ".",
  output: "src/locales/$LOCALE/$NAMESPACE.json",
  input: ["src/**/*.{ts,tsx}"],
  // Keep existing translations; only add newly-discovered keys.
  keepRemoved: true,
  sort: true,
  createOldCatalogs: false,
};
