import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SERVICE_LOGOS } from "../PersonalAgentSection/brand-logos";
import "./ServiceButtonRail.css";

/**
 * Skeuomorphic vertical rail of physical service buttons that sits at the
 * far left of the WebGL `IsolatedDevice` in the Built for trust section.
 * Each button is a raised keycap (recessed socket + bevelled cap, mirroring
 * the `SkillSeaCard` macro-pad keys) carrying a monochrome service glyph
 * from the shared `SERVICE_LOGOS` set.
 *
 * The lit behaviour matches the integrations grid in `ServiceDeviceCard`:
 * an ambient auto-cycle pulses a new key on a loop so the rail twinkles
 * through services, and clicking a key pulses just that one. Both paths go
 * through `pulseLogo`, which lights a key gold then settles it after a
 * duration; multiple keys can be lit at once. Purely decorative
 * (`aria-hidden`) — it sells the breadth of integrations visually.
 */

/** The first eight services from the shared set fill the rail. */
const RAIL_LOGOS = SERVICE_LOGOS.slice(0, 8);

/** How long a clicked key holds its gold glow before settling back. */
const CLICK_PULSE_MS = 1500;
/** How long an auto-cycle spotlight holds a key before settling back. */
const CYCLE_PULSE_MS = 700;
/** Auto-cycle tick interval. */
const CYCLE_TICK_MS = 600;
/** Stride coprime with the key count so the spotlight hops around the rail. */
const CYCLE_STRIDE = 3;
/** How long a click pauses the auto-cycle so the visitor can inspect. */
const CLICK_PAUSE_MS = 2000;

export function ServiceButtonRail(): ReactNode {
  const [litLogos, setLitLogos] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const litTimersRef = useRef<Map<number, number>>(new Map());
  // Wall-clock timestamp until which the auto-cycle spotlight is paused.
  const pauseCycleUntilRef = useRef<number>(0);

  const pulseLogo = useCallback((index: number, durationMs: number) => {
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
    if (RAIL_LOGOS.length === 0 || typeof window === "undefined") {
      return;
    }
    let cycleIndex = 0;
    const timer = window.setInterval(() => {
      if (Date.now() < pauseCycleUntilRef.current) {
        return;
      }
      pulseLogo((cycleIndex * CYCLE_STRIDE) % RAIL_LOGOS.length, CYCLE_PULSE_MS);
      cycleIndex += 1;
    }, CYCLE_TICK_MS);
    return () => window.clearInterval(timer);
  }, [pulseLogo]);

  return (
    <div className="serviceButtonRail" aria-hidden="true">
      {RAIL_LOGOS.map((logo, index) => (
        <div key={logo.id} className="serviceButtonSocket">
          <button
            type="button"
            tabIndex={-1}
            className="serviceButtonKey"
            data-active={litLogos.has(index) ? "true" : undefined}
            aria-label={logo.label}
            title={logo.label}
            onClick={() => {
              pauseCycleUntilRef.current = Date.now() + CLICK_PAUSE_MS;
              pulseLogo(index, CLICK_PULSE_MS);
            }}
          >
            <svg
              width={22}
              height={22}
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d={logo.path} />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
