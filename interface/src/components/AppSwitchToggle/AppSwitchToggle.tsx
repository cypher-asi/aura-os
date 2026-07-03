import { memo, useEffect, useRef, useState } from "react";
import { cn } from "@cypher-asi/zui";
import styles from "./AppSwitchToggle.module.css";

export interface AppSwitchOption {
  id: string;
  label: string;
}

export interface AppSwitchToggleProps {
  /** The two sides of the switch. The first two entries drive the slide. */
  options: readonly AppSwitchOption[];
  /** Id of the currently-selected option. */
  active: string;
  /** Fired with the option id when the user picks the inactive side. */
  onChange: (id: string) => void;
  /** Accessible label for the group. */
  ariaLabel?: string;
  /** Slightly roomier treatment for the top-level Chat / Build switch. */
  variant?: "default" | "primary";
}

// Crossfade duration. Only used to release the optimistic `pending` pin
// after the CSS opacity transition has finished; the fade itself is
// driven entirely by CSS, so this value is not timing-critical.
const SWITCH_FADE_MS = 320;

/**
 * Flat, plate-mounted two-up toggle. Fully generic: it knows nothing
 * about routing or which apps it switches between — the caller owns the
 * options and the `onChange` side effect.
 *
 * The foundation is a fixed-size gradient `.plate` holding a recessed
 * `.panel` track. Each side has its own `.thumb` (the selected look);
 * exactly one is visible at a time. Switching is a pure CSS opacity
 * crossfade: the old side's thumb fades out while the new side's thumb
 * fades in, keyed off `data-active-index`. Because the fade is a
 * compositor-driven `opacity` transition — not a JS-timed swap — it stays
 * smooth even while the caller mounts whatever the new selection points
 * at, and opacity (unlike transform) is reduced-motion friendly.
 *
 * The selected side is flipped optimistically via `pending` so the
 * crossfade starts on the click frame rather than waiting for the
 * caller's `onChange` (e.g. a deferred route swap) to push down a new
 * `active` prop. The pin is released once the fade has settled.
 *
 * Memoized so it stays inert while its host re-renders for unrelated
 * reasons: it only re-renders when `options`, `active`, or `onChange`
 * actually change.
 */
function AppSwitchToggleBase({
  options,
  active,
  onChange,
  ariaLabel = "Switch",
  variant = "default",
}: AppSwitchToggleProps): React.ReactElement {
  const [pending, setPending] = useState<string | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const selected = pending ?? active;

  useEffect(() => {
    return () => {
      if (pendingTimerRef.current != null) window.clearTimeout(pendingTimerRef.current);
    };
  }, []);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selected),
  );

  return (
    <div className={cn(styles.wrap, variant === "primary" && styles.wrapPrimary)}>
      <div className={styles.plate}>
        <div
          className={styles.panel}
          data-active-index={activeIndex}
          role="group"
          aria-label={ariaLabel}
        >
          <span className={cn(styles.thumb, styles.thumbStart)} aria-hidden="true" />
          <span className={cn(styles.thumb, styles.thumbEnd)} aria-hidden="true" />
          {options.map((option) => {
            const isActive = option.id === selected;
            return (
              <button
                key={option.id}
                type="button"
                className={cn(styles.half, isActive && styles.halfActive)}
                aria-pressed={isActive}
                onClick={() => {
                  if (isActive) return;
                  const nextId = option.id;
                  // Flip the selected side optimistically so the opacity
                  // crossfade starts on the click frame. Release the pin
                  // once the fade has settled — by then `active` has caught
                  // up to the same side. The component owns only its own
                  // animation; how `onChange` schedules whatever it drives
                  // is entirely the caller's concern.
                  setPending(nextId);
                  if (pendingTimerRef.current != null) {
                    window.clearTimeout(pendingTimerRef.current);
                  }
                  pendingTimerRef.current = window.setTimeout(() => {
                    setPending(null);
                    pendingTimerRef.current = null;
                  }, SWITCH_FADE_MS);
                  onChange(nextId);
                }}
              >
                <span className={styles.label}>{option.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const AppSwitchToggle = memo(AppSwitchToggleBase);
