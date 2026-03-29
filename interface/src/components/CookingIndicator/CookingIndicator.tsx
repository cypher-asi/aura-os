import styles from "./CookingIndicator.module.css";

interface CookingIndicatorProps {
  label?: string;
}

export function CookingIndicator({ label = "Cooking..." }: CookingIndicatorProps) {
  return (
    <div className={styles.cookingIndicator}>
      <span className={styles.cookingText}>{label}</span>
    </div>
  );
}
