import { Check, Zap } from "lucide-react";
import { SecurityBadge } from "./SecurityBadge";
import type { SkillStoreCatalogEntry } from "../../types";
import styles from "./SkillStoreModal.module.css";

interface SkillStoreCardProps {
  entry: SkillStoreCatalogEntry;
  installed: boolean;
  onClick: () => void;
}

export function SkillStoreCard({ entry, installed, onClick }: SkillStoreCardProps) {
  return (
    <button type="button" className={styles.card} onClick={onClick}>
      <div className={styles.cardEmoji}>
        {entry.emoji ? <span>{entry.emoji}</span> : <Zap size={24} />}
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
      </div>
    </button>
  );
}
