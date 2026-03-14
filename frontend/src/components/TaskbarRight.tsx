import { Button } from "@cypher-asi/zui";
import { CreditsBadge } from "./CreditsBadge";
import styles from "./TaskbarRight.module.css";

interface Props {
  onBuyCredits?: () => void;
}

export function TaskbarRight({ onBuyCredits }: Props) {
  return (
    <div className={`taskbar-section ${styles.container}`}>
      <CreditsBadge onClick={onBuyCredits} />
      <Button variant="secondary" size="sm" onClick={onBuyCredits}>
        Buy Credits
      </Button>
    </div>
  );
}
