import { Spinner } from "@cypher-asi/zui";
import styles from "./RouteFallback.module.css";

/** Full-area placeholder while a lazy route chunk loads (inside the authenticated shell). */
export function RouteFallback() {
  return (
    <div className={styles.root} role="status" aria-live="polite" aria-busy="true">
      <Spinner size="lg" />
      <span className={styles.label}>Loading…</span>
    </div>
  );
}
