import styles from "./CookingIndicator.module.css";

interface CookingIndicatorProps {
  label?: string;
  hidden?: boolean;
}

export function CookingIndicator({
  label = "Cooking...",
  hidden = false,
}: CookingIndicatorProps) {
  return (
    <div
      className={`${styles.cookingIndicator}${hidden ? ` ${styles.cookingIndicatorHidden}` : ""}`}
      aria-hidden={hidden}
    >
      <span className={`${styles.cookingText}${hidden ? ` ${styles.cookingTextHidden}` : ""}`}>
        {label}
      </span>
    </div>
  );
}
