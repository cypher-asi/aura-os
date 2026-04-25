import { useCreditBalance } from "./useCreditBalance";
import { formatCredits } from "../../shared/utils/format";
import styles from "./CreditsBadge.module.css";

export { CREDITS_UPDATED_EVENT } from "./useCreditBalance";

interface Props {
  onClick?: () => void;
}

export function CreditsBadge({ onClick }: Props) {
  const { credits } = useCreditBalance();

  const display = credits !== null ? formatCredits(credits) : "---";
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
