import { useMemo, useState } from "react";
import { Panel, Text } from "@cypher-asi/zui";
import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLanguageStore } from "../../../stores/language-store";
import { LANGUAGES } from "../../../i18n/languages";
import styles from "./LanguageSection.module.css";

export function LanguageSection() {
  const { t } = useTranslation("settings");
  const language = useLanguageStore((s) => s.language);
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) =>
        l.nativeName.toLowerCase().includes(q) ||
        l.englishName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Panel
      variant="solid"
      border="solid"
      borderRadius="md"
      className={styles.languagePanel}
      data-testid="settings-language-panel"
    >
      <Text weight="semibold" size="sm">
        {t("language.title")}
      </Text>
      <Text variant="muted" size="sm">
        {t("language.description")}
      </Text>

      <div className={styles.search}>
        <Search size={14} className={styles.searchIcon} aria-hidden="true" />
        <input
          type="text"
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("language.searchPlaceholder")}
          aria-label={t("language.searchPlaceholder")}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <ul className={styles.list} role="listbox" aria-label={t("language.title")}>
        {filtered.map((lang) => {
          const selected = lang.code === language;
          return (
            <li key={lang.code}>
              <button
                type="button"
                role="option"
                aria-selected={selected}
                className={`${styles.row}${selected ? ` ${styles.rowSelected}` : ""}`}
                onClick={() => setLanguage(lang.code)}
                lang={lang.code}
                dir={lang.dir}
              >
                <span className={styles.rowText}>
                  <span className={styles.nativeName}>{lang.nativeName}</span>
                  <span className={styles.englishName}>{lang.englishName}</span>
                </span>
                {selected && <Check size={16} className={styles.check} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className={styles.empty}>
            <Text variant="muted" size="sm">
              {t("language.noResults")}
            </Text>
          </li>
        )}
      </ul>
    </Panel>
  );
}
