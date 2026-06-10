import { type ReactNode, useEffect, useState } from "react";
import "./expertiseContent.css";

const TYPE_MS = 26;
const LINE_GAP_MS = 220;
const HOLD_MS = 4200;

/**
 * Left-flank capability list for a non-General discipline. Reveals bullets one
 * character at a time (typewriter), line after line, holds the full list, then
 * loops. Vertically centered via the `.nrCapabilityField` flex container. The
 * card keys this by discipline, so it restarts on every switch. Decorative
 * (the screen is `aria-hidden`). The per-discipline phrases + example mockups
 * live in `expertiseExamples.tsx`.
 *
 * Like the General-mode code flank, the gallery, the brain, and the ACTIVATION
 * readout, this types out unconditionally (it does not honor
 * `prefers-reduced-motion`) so the whole always-on device stays consistent —
 * switching disciplines always writes the list out rather than snapping it in.
 */
export function CapabilityList({
  capabilities,
}: {
  capabilities: readonly string[];
}): ReactNode {
  // `done` = count of fully typed lines; `typed` = chars typed of the line at
  // index `done` (the one currently being written).
  const [done, setDone] = useState(0);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (done >= capabilities.length) {
      const restart = window.setTimeout(() => {
        setDone(0);
        setTyped(0);
      }, HOLD_MS);
      return () => window.clearTimeout(restart);
    }
    const current = capabilities[done] ?? "";
    if (typed < current.length) {
      const next = window.setTimeout(() => setTyped((n) => n + 1), TYPE_MS);
      return () => window.clearTimeout(next);
    }
    const nextLine = window.setTimeout(() => {
      setDone((n) => n + 1);
      setTyped(0);
    }, LINE_GAP_MS);
    return () => window.clearTimeout(nextLine);
  }, [done, typed, capabilities]);

  return (
    <ul className="nrCapList">
      {capabilities.map((item, i) => {
        if (i > done) return null;
        const fullyTyped = i < done;
        const text = fullyTyped ? item : item.slice(0, typed);
        const active = i === done && done < capabilities.length;
        return (
          <li className="nrCapItem" key={item}>
            <span className="nrCapBullet" />
            <span className="nrCapText">
              {text}
              {active ? <span className="nrCapCaret" /> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
