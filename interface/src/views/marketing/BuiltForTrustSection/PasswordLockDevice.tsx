import { useEffect, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./PasswordLockDevice.css";

/** Total password dot slots on the device screen. */
const MAX_DOTS = 6;

/** Delay between successive dots appearing/disappearing. */
const STEP_MS = 340;

/** Hold time with the password fully entered before it counts back down. */
const HOLD_FULL_MS = 1400;

/** Hold time with the screen empty before the next entry begins. */
const HOLD_EMPTY_MS = 900;

/** Stroked padlock glyph for the round lock keycap. */
function LockGlyph(): ReactNode {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="5" y="10.5" width="14" height="10" rx="2.4" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="14.6" r="1.1" fill="currentColor" stroke="none" />
      <path d="M12 15.7v1.6" />
    </svg>
  );
}

/**
 * Decorative media for the "Isolated by default." trust card: a pill-shaped
 * lock device rendered in the site's dark machined-metal language (shared
 * three-ring `Plate` rim, recessed near-black screen, raised circular lock
 * keycap with a gold-glowing padlock glyph seated inside the shell).
 *
 * A password is forever being entered: glowing dots count up to the full
 * six, hold, then count back down, with the dot group staying horizontally
 * centered as it grows and shrinks. Purely decorative, so the whole stage
 * is `aria-hidden`.
 */
export function PasswordLockDevice(): ReactNode {
  const [count, setCount] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);

  // One-shot timer per (count, dir) state: step the dot count in the
  // current direction, or hold at either edge before reversing.
  useEffect(() => {
    const atEdge =
      (dir === 1 && count === MAX_DOTS) || (dir === -1 && count === 0);
    const delay = atEdge
      ? count === MAX_DOTS
        ? HOLD_FULL_MS
        : HOLD_EMPTY_MS
      : STEP_MS;
    const id = window.setTimeout(() => {
      if (atEdge) {
        setDir(dir === 1 ? -1 : 1);
      } else {
        setCount(count + dir);
      }
    }, delay);
    return () => window.clearTimeout(id);
  }, [count, dir]);

  return (
    <div className="passwordLockStage" aria-hidden="true">
      <Plate radius="999px" className="passwordLockShell">
        <div className="passwordLockBody">
          <div className="passwordLockScreen">
            <div className="passwordLockDots">
              {Array.from({ length: MAX_DOTS }).map((_, i) => (
                <span
                  key={i}
                  className={
                    i < count
                      ? "passwordLockDotCell passwordLockDotCellLit"
                      : "passwordLockDotCell"
                  }
                >
                  <span className="passwordLockDot" />
                </span>
              ))}
            </div>
          </div>
          <span className="passwordLockKey">
            <LockGlyph />
          </span>
        </div>
      </Plate>
    </div>
  );
}
