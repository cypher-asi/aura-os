import { Wifi, WifiOff } from "lucide-react";
import { useConnectionStatus } from "./useConnectionStatus";
import styles from "./ConnectionDot.module.css";

export function ConnectionDot() {
  const { connected, stale } = useConnectionStatus();

  if (!connected) {
    return (
      <span className={styles.connectionDot} title="Disconnected — reconnecting...">
        <WifiOff size={12} style={{ color: "var(--color-danger, #e55)" }} />
      </span>
    );
  }
  if (stale) {
    return (
      <span className={styles.connectionDot} title="Connected but no events received recently">
        <Wifi size={12} style={{ color: "var(--color-warning, #ea0)" }} />
      </span>
    );
  }
  return (
    <span className={styles.connectionDot} title="Connected — receiving events">
      <Wifi size={12} style={{ color: "var(--color-success, #4c9)" }} />
    </span>
  );
}
