import styles from "./CookingIndicator.module.css";

interface CookingIndicatorProps {
  label?: string;
  hidden?: boolean;
}

export function CookingIndicator({
  label = "Cooking...",
  hidden = false,
}: CookingIndicatorProps) {
  if (hidden) {
    return null;
  }

  return (
    <div className={styles.cookingIndicator}>
      <span className={styles.cookingText}>{label}</span>
    </div>
  );
}
