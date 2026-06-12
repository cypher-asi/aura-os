import { useMemo, useState } from "react";
import { DynamicIcon, iconNames } from "lucide-react/dynamic";
import { Input, Text } from "@cypher-asi/zui";
import { APPEARANCE_ICON_PRESETS } from "./appearance-icon-presets";
import styles from "./AppearanceTab.module.css";

/**
 * Cap on search results so a single-character query (which can match
 * thousands of icons) doesn't blow up render time. Higher than what a
 * user will realistically scroll through; lower than what makes
 * `<DynamicIcon>`'s per-icon lazy-import noticeable.
 */
const SEARCH_RESULT_LIMIT = 120;

interface LucideIconPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
}

/**
 * Project icon picker. Two modes:
 *
 * 1. **Default (no search):** renders a curated grid of ~100 popular
 *    project-identity icons from `APPEARANCE_ICON_PRESETS`. Fast first
 *    paint, biased toward shapes that read clearly at small sizes.
 *
 * 2. **Searching:** filters the full Lucide name list (~1500) by
 *    substring match against the kebab-case names, capped at
 *    `SEARCH_RESULT_LIMIT`. Matches are rendered lazily by
 *    `<DynamicIcon>` so we only pay for the icons that scroll into
 *    view.
 *
 * Icons are stored as the kebab-case Lucide name string (e.g.
 * `"rocket"`) so they round-trip through `appearance.json` without
 * needing a component registry.
 */
export function LucideIconPicker({ value, onChange }: LucideIconPickerProps) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim().toLowerCase();

  const candidates = useMemo(() => {
    if (!trimmed) return APPEARANCE_ICON_PRESETS;
    const matches: string[] = [];
    for (const name of iconNames) {
      if (name.includes(trimmed)) {
        matches.push(name);
        if (matches.length >= SEARCH_RESULT_LIMIT) break;
      }
    }
    return matches;
  }, [trimmed]);

  return (
    <div className={styles.controlGroup}>
      <div className={styles.iconHeader}>
        <Text variant="muted" size="sm" className={styles.sectionLabel}>
          Icon
        </Text>
        {value && (
          <button
            type="button"
            className={styles.miniButton}
            onClick={() => onChange(undefined)}
          >
            Clear
          </button>
        )}
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons…"
      />

      <div className={styles.iconGrid} role="listbox" aria-label="Project icon">
        {candidates.map((name) => (
          <button
            key={name}
            type="button"
            className={`${styles.iconButton} ${value === name ? styles.iconButtonActive : ""}`}
            onClick={() => onChange(name)}
            title={name}
            aria-label={`Use ${name}`}
            role="option"
            aria-selected={value === name}
          >
            <DynamicIcon name={name as Parameters<typeof DynamicIcon>[0]["name"]} size={18} />
          </button>
        ))}
        {candidates.length === 0 && (
          <Text variant="muted" size="sm">
            No icons match “{query}”.
          </Text>
        )}
      </div>
      {trimmed && candidates.length >= SEARCH_RESULT_LIMIT && (
        <Text variant="muted" size="xs">
          Showing first {SEARCH_RESULT_LIMIT} matches — refine your search to narrow further.
        </Text>
      )}
    </div>
  );
}
