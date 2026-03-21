import { Wifi, WifiOff } from "lucide-react";
import { useConnectionStatus } from "./useConnectionStatus";
import styles from "./ConnectionDot.module.css";

export function ConnectionDot() {
  const { connected, stale } = useConnectionStatus();

  if (!connected) {
    return (
      <span className={styles.connectionDot} title="Disconnected — reconnecting...">
        <WifiOff size={12} className={styles.iconDanger} />
      </span>
    );
  }
  if (stale) {
    return (
      <span className={styles.connectionDot} title="Connected but no events received recently">
        <Wifi size={12} className={styles.iconWarning} />
      </span>
    );
  }
  return (
    <span className={styles.connectionDot} title="Connected — receiving events">
      <Wifi size={12} className={styles.iconSuccess} />
    </span>
  );
}
