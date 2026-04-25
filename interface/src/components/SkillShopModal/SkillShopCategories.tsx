import type { SkillCategory, SkillShopCatalogEntry } from "../../shared/types";
import styles from "./SkillShopModal.module.css";

const CATEGORY_LABELS: Record<SkillCategory | "all", string> = {
  all: "All",
  development: "Development",
  communication: "Communication",
  productivity: "Productivity",
  notes: "Notes",
  media: "Media",
  "ai-ml": "AI / ML",
  "smart-home": "Smart Home",
  security: "Security",
  automation: "Automation",
  utilities: "Utilities",
};

const CATEGORY_ORDER: (SkillCategory | "all")[] = [
  "all", "development", "communication", "productivity", "notes",
  "media", "ai-ml", "smart-home", "security", "automation", "utilities",
];

interface SkillShopCategoriesProps {
  catalog: SkillShopCatalogEntry[];
  selected: SkillCategory | "all";
  onSelect: (cat: SkillCategory | "all") => void;
}

export function SkillShopCategories({ catalog, selected, onSelect }: SkillShopCategoriesProps) {
  const counts: Record<string, number> = { all: catalog.length };
  for (const entry of catalog) {
    counts[entry.category] = (counts[entry.category] ?? 0) + 1;
  }

  return (
    <nav className={styles.categories}>
      {CATEGORY_ORDER.map((cat) => {
        const count = counts[cat] ?? 0;
        if (cat !== "all" && count === 0) return null;
        return (
          <button
            key={cat}
            type="button"
            className={`${styles.categoryBtn} ${cat === selected ? styles.categoryActive : ""}`}
            onClick={() => onSelect(cat)}
          >
            <span className={styles.categoryLabel}>{CATEGORY_LABELS[cat]}</span>
            <span className={styles.categoryCount}>{count}</span>
          </button>
        );
      })}
    </nav>
  );
}
