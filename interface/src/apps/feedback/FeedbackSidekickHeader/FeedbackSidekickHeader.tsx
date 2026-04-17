import { Button } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { useFeedback, useFeedbackItem } from "../../../stores/feedback-store";
import { categoryLabel } from "../types";
import styles from "./FeedbackSidekickHeader.module.css";

export function FeedbackSidekickHeader() {
  const { selectedId, selectItem } = useFeedback();
  const item = useFeedbackItem(selectedId);

  if (!item) return null;

  return (
    <div className={styles.header}>
      <span className={styles.meta}>{item.author.name}</span>
      <span className={styles.separator}>&middot;</span>
      <span className={styles.meta}>{categoryLabel(item.category)}</span>
      <span className={styles.spacer} />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<X size={14} />}
        aria-label="Close feedback detail"
        onClick={() => selectItem(null)}
      />
    </div>
  );
}
