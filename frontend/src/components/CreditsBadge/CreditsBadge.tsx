import { useCreditBalance } from "./useCreditBalance";
import styles from "./CreditsBadge.module.css";

export { CREDITS_UPDATED_EVENT } from "./useCreditBalance";

function formatCredits(n: number): string {
  return n.toLocaleString();
}

interface Props {
  onClick?: () => void;
}

export function CreditsBadge({ onClick }: Props) {
  const { credits } = useCreditBalance();

  const displayCredits = credits !== null ? formatCredits(credits) : "---";
  return (
    <button
      className={styles.creditsBadge}
      onClick={onClick}
      type="button"
    >
      <span className={styles.label}>{displayCredits} Z</span>
    </button>
  );
}
