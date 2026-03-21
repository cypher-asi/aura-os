import { useCreditBalance } from "./useCreditBalance";
import styles from "./CreditsBadge.module.css";

export { CREDITS_UPDATED_EVENT } from "./useCreditBalance";

interface Props {
  onClick?: () => void;
}

export function CreditsBadge({ onClick }: Props) {
  const { balanceFormatted } = useCreditBalance();

  const display = balanceFormatted ?? "---";
  return (
    <button
      className={styles.creditsBadge}
      onClick={onClick}
      type="button"
    >
      <span className={styles.label}>{display}</span>
    </button>
  );
}
