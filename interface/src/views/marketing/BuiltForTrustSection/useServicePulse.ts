import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared "twinkle" controller for the trust device's service rail and its
 * connection mesh. Mirrors the integrations grid in `ServiceDeviceCard`: an
 * ambient auto-cycle pulses a new index on a loop, and an explicit
 * `activate(index)` (a click) pulses just that one while pausing the cycle so
 * the visitor can inspect their pick. Multiple indices can be lit at once.
 *
 * The lit set lives here (rather than inside the rail) so both the rail keys
 * and the SVG mesh lines can read the same state and light together.
 */

/** How long a clicked key holds its gold glow before settling back. */
const CLICK_PULSE_MS = 1500;
/** How long an auto-cycle spotlight holds a key before settling back. */
const CYCLE_PULSE_MS = 700;
/** Auto-cycle tick interval. */
const CYCLE_TICK_MS = 600;
/** How long a click pauses the auto-cycle so the visitor can inspect. */
const CLICK_PAUSE_MS = 2000;

export interface ServicePulse {
  readonly litLogos: ReadonlySet<number>;
  /** Pulse a single index for the click duration and pause the auto-cycle. */
  readonly activate: (index: number) => void;
}

export function useServicePulse(count: number): ServicePulse {
  const [litLogos, setLitLogos] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const litTimersRef = useRef<Map<number, number>>(new Map());
  // Wall-clock timestamp until which the auto-cycle spotlight is paused.
  const pauseCycleUntilRef = useRef<number>(0);

  const pulse = useCallback((index: number, durationMs: number) => {
    if (typeof window === "undefined") {
      return;
    }
    setLitLogos((prev) => {
      if (prev.has(index)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    const existing = litTimersRef.current.get(index);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      setLitLogos((prev) => {
        if (!prev.has(index)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      litTimersRef.current.delete(index);
    }, durationMs);
    litTimersRef.current.set(index, timer);
  }, []);

  const activate = useCallback(
    (index: number) => {
      pauseCycleUntilRef.current = Date.now() + CLICK_PAUSE_MS;
      pulse(index, CLICK_PULSE_MS);
    },
    [pulse],
  );

  useEffect(() => {
    const timers = litTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (count <= 0 || typeof window === "undefined") {
      return;
    }
    // Step by a stride coprime with the count so the spotlight hops around
    // the rail rather than marching strictly top-to-bottom.
    const stride = count % 3 === 0 ? 5 : 3;
    let cycleIndex = 0;
    const timer = window.setInterval(() => {
      if (Date.now() < pauseCycleUntilRef.current) {
        return;
      }
      pulse((cycleIndex * stride) % count, CYCLE_PULSE_MS);
      cycleIndex += 1;
    }, CYCLE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [count, pulse]);

  return { litLogos, activate };
}
