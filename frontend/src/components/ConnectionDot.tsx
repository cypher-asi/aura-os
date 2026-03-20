import { useState, useEffect, useRef } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { useEventContext } from "../context/EventContext";
import styles from "./ConnectionDot.module.css";

export function ConnectionDot() {
  const { connected, getLastEventAt } = useEventContext();
  const [stale, setStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!connected) {
      const frame = window.requestAnimationFrame(() => setStale(false));
      return () => window.cancelAnimationFrame(frame);
    }
    intervalRef.current = setInterval(() => {
      const ts = getLastEventAt();
      setStale(ts !== null && Date.now() - ts > 10_000);
    }, 2_000);
    return () => clearInterval(intervalRef.current);
  }, [connected, getLastEventAt]);

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
