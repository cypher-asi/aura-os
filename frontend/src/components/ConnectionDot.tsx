import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useEventContext } from "../context/EventContext";
import styles from "./ConnectionDot.module.css";

export function ConnectionDot() {
  const { connected, lastEventAt } = useEventContext();
  const [stale, setStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      if (connected && lastEventAt) {
        setStale(Date.now() - lastEventAt > 10_000);
      } else {
        setStale(false);
      }
    }, 2_000);
    return () => clearInterval(intervalRef.current);
  }, [connected, lastEventAt]);

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
