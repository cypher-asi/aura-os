import { Check } from "lucide-react";
import { SkillIcon } from "./SkillIcon";
import { SecurityBadge } from "./SecurityBadge";
import type { SkillShopCatalogEntry } from "../../shared/types";
import styles from "./SkillShopModal.module.css";

interface SkillShopCardProps {
  entry: SkillShopCatalogEntry;
  installed: boolean;
  onClick: () => void;
}

export function SkillShopCard({ entry, installed, onClick }: SkillShopCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.cardIcon}>
        <SkillIcon name={entry.name} size={24} />
      </div>
      <div className={styles.cardBody}>
        <div className={styles.cardName}>
          {entry.name}
          {installed && (
            <span className={styles.cardInstalled} title="Installed">
              <Check size={12} />
            </span>
          )}
        </div>
        <div className={styles.cardDesc}>{entry.description}</div>
      </div>
      <div className={styles.cardFooter}>
        <SecurityBadge rating={entry.security_rating} />
        {entry.os !== "any" && (
          <span className={styles.osBadge}>{entry.os}</span>
        )}
      </div>
    </button>
  );
}
