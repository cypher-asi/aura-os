import { useEffect, useRef, useState, useCallback } from "react";
import type { EngineEvent } from "../types/events";
import { createReconnectingWebSocket } from "./ws-reconnect";

const WS_URL = `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws/events`;
const MAX_EVENTS = 500;

export interface EventStreamState {
  connected: boolean;
  events: EngineEvent[];
  latestEvent: EngineEvent | null;
}

export function useEventStream(
  onEvent?: (event: EngineEvent) => void,
): EventStreamState {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<EngineEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<EngineEvent | null>(null);
  const wsRef = useRef<{ close: () => void } | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const handleMessage = useCallback((data: string) => {
    try {
      const event: EngineEvent = JSON.parse(data);
      setLatestEvent(event);
      setEvents((prev) => {
        const next = [...prev, event];
        return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
      });
      onEventRef.current?.(event);
    } catch {
      // ignore malformed events
    }
  }, []);

  useEffect(() => {
    wsRef.current = createReconnectingWebSocket(
      {
        url: WS_URL,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
      },
      handleMessage,
      setConnected,
    );

    return () => {
      wsRef.current?.close();
    };
  }, [handleMessage]);

  return { connected, events, latestEvent };
}
