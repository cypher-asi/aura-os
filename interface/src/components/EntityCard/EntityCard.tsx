import { useState } from "react";
import type { ReactNode } from "react";
import styles from "./EntityCard.module.css";

interface EntityCardProps {
  headerLabel: string;
  headerStatus?: string;
  image?: string;
  fallbackIcon: ReactNode;
  name: string;
  subtitle?: string;
  status?: string;
  nameAction?: ReactNode;
  children?: ReactNode;
  stats?: { value: string | number; label: string }[];
  footer?: string;
}

function ImageBlock({ image, name, fallbackIcon }: { image?: string; name: string; fallbackIcon: ReactNode }) {
  const [broken, setBroken] = useState(false);

  return (
    <div className={styles.imageBlock}>
      {image && !broken ? (
        <img src={image} alt={name} className={styles.image} onError={() => setBroken(true)} />
      ) : (
        fallbackIcon
      )}
    </div>
  );
}

export function EntityCard({
  headerLabel,
  headerStatus,
  image,
  fallbackIcon,
  name,
  subtitle,
  status,
  nameAction,
  children,
  stats,
  footer,
}: EntityCardProps) {
  return (
    <div className={styles.cardContainer}>
      <div className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.cardHeaderLabel}>{headerLabel}</span>
          {headerStatus && (
            <span className={styles.cardHeaderStatus}>{headerStatus}</span>
          )}
        </div>

        <div className={styles.imageBlockWrap}>
          <ImageBlock image={image} name={name} fallbackIcon={fallbackIcon} />
          {status && <span className={styles.statusDot} data-status={status} />}
        </div>

        <div className={styles.nameRow}>
          <div className={styles.nameText}>
            <span className={styles.displayName}>{name}</span>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
          {nameAction && <div className={styles.nameAction}>{nameAction}</div>}
        </div>

        {children && <div className={styles.body}>{children}</div>}

        {stats && stats.length > 0 && (
          <div className={styles.statsRow}>
            {stats.map((s) => (
              <div key={s.label} className={styles.stat}>
                <span className={styles.statValue}>{s.value}</span>
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        )}

        {footer && (
          <div className={styles.cardFooter}>
            <span className={styles.footerLabel}>{footer}</span>
          </div>
        )}
      </div>
    </div>
  );
}
