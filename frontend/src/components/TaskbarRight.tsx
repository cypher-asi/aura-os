import { CreditsBadge } from "./CreditsBadge";
import styles from "./TaskbarRight.module.css";

interface Props {
  onBuyCredits?: () => void;
}

export function TaskbarRight({ onBuyCredits }: Props) {
  return (
    <div className={styles.container}>
      <CreditsBadge onClick={onBuyCredits} />
    </div>
  );
}
