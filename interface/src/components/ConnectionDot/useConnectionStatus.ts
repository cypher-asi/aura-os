import { useState, useEffect, useRef } from "react";
import { useEventStore } from "../../stores/event-store";

interface ConnectionStatusResult {
  connected: boolean;
  stale: boolean;
}

export function useConnectionStatus(): ConnectionStatusResult {
  const connected = useEventStore((s) => s.connected);
  const [stale, setStale] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!connected) {
      const frame = window.requestAnimationFrame(() => setStale(false));
      return () => window.cancelAnimationFrame(frame);
    }
    intervalRef.current = setInterval(() => {
      const ts = useEventStore.getState().lastEventAt;
      setStale(ts !== null && Date.now() - ts > 10_000);
    }, 2_000);
    return () => clearInterval(intervalRef.current);
  }, [connected]);

  return { connected, stale };
}
