import { useEffect, useState } from "react";
import { Coins } from "lucide-react";
import { useOrg } from "../context/OrgContext";
import { api } from "../api/client";
import styles from "./CreditsBadge.module.css";

function formatCredits(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
}

interface Props {
  onClick?: () => void;
}

export function CreditsBadge({ onClick }: Props) {
  const { activeOrg } = useOrg();
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    if (!activeOrg) {
      setCredits(null);
      return;
    }
    let cancelled = false;
    api.orgs
      .getCreditBalance(activeOrg.org_id)
      .then((b) => {
        if (!cancelled) setCredits(b.total_credits);
      })
      .catch(() => {
        if (!cancelled) setCredits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeOrg?.org_id]);

  const displayCredits = credits !== null ? formatCredits(credits) : "0";
  return (
    <div className={styles.creditsBadge} onClick={onClick} role="button" tabIndex={0}>
      <span className={displayCredits === "0" ? `${styles.label} ${styles.labelSecondary}` : styles.label}>{displayCredits}</span>
      <Coins size={14} className={styles.icon} />
    </div>
  );
}
