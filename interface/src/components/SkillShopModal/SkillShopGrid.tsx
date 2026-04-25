import { SkillShopCard } from "./SkillShopCard";
import type { SkillShopCatalogEntry } from "../../shared/types";
import styles from "./SkillShopModal.module.css";

interface SkillShopGridProps {
  entries: SkillShopCatalogEntry[];
  installedNames: Set<string>;
  onSelect: (entry: SkillShopCatalogEntry) => void;
}

export function SkillShopGrid({ entries, installedNames, onSelect }: SkillShopGridProps) {
  if (entries.length === 0) {
    return <div className={styles.gridEmpty}>No skills match your search</div>;
  }

  return (
    <div className={styles.grid}>
      {entries.map((entry) => (
        <SkillShopCard
          key={entry.name}
          entry={entry}
          installed={installedNames.has(entry.name)}
          onClick={() => onSelect(entry)}
        />
      ))}
    </div>
  );
}
