import { createContext, useContext, useCallback, useRef } from "react";
import type { EngineEvent, EngineEventType } from "../types/events";
import { useEventStream } from "../hooks/use-event-stream";

type EventCallback = (event: EngineEvent) => void;

interface EventContextValue {
  connected: boolean;
  events: EngineEvent[];
  latestEvent: EngineEvent | null;
  subscribe: (type: EngineEventType, callback: EventCallback) => () => void;
}

const EventContext = createContext<EventContextValue | null>(null);

export function EventProvider({ children }: { children: React.ReactNode }) {
  const subscribersRef = useRef<Map<EngineEventType, Set<EventCallback>>>(new Map());

  const dispatchEvent = useCallback((event: EngineEvent) => {
    const subs = subscribersRef.current.get(event.type);
    if (subs) subs.forEach((cb) => cb(event));
  }, []);

  const stream = useEventStream(dispatchEvent);

  const subscribe = useCallback(
    (type: EngineEventType, callback: EventCallback) => {
      const map = subscribersRef.current;
      if (!map.has(type)) {
        map.set(type, new Set());
      }
      map.get(type)!.add(callback);

      return () => {
        map.get(type)?.delete(callback);
      };
    },
    [],
  );

  return (
    <EventContext.Provider
      value={{
        connected: stream.connected,
        events: stream.events,
        latestEvent: stream.latestEvent,
        subscribe,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEventContext(): EventContextValue {
  const ctx = useContext(EventContext);
  if (!ctx) {
    throw new Error("useEventContext must be used within an EventProvider");
  }
  return ctx;
}
