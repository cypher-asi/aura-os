import { SkillStoreCard } from "./SkillStoreCard";
import type { SkillStoreCatalogEntry } from "../../types";
import styles from "./SkillStoreModal.module.css";

interface SkillStoreGridProps {
  entries: SkillStoreCatalogEntry[];
  installedNames: Set<string>;
  onSelect: (entry: SkillStoreCatalogEntry) => void;
}

export function SkillStoreGrid({ entries, installedNames, onSelect }: SkillStoreGridProps) {
  if (entries.length === 0) {
    return <div className={styles.gridEmpty}>No skills match your search</div>;
  }

  return (
    <div className={styles.grid}>
      {entries.map((entry) => (
        <SkillStoreCard
          key={entry.name}
          entry={entry}
          installed={installedNames.has(entry.name)}
          onClick={() => onSelect(entry)}
        />
      ))}
    </div>
  );
}
