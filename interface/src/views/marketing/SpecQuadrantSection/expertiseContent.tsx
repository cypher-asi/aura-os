import { type ReactNode, useEffect, useState } from "react";
import "./expertiseContent.css";

const TYPE_MS = 26;
const LINE_GAP_MS = 220;
const HOLD_MS = 4200;

/** Live `prefers-reduced-motion` flag (renders the full list at once when set). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

/**
 * Left-flank capability list for a non-General discipline. Reveals bullets one
 * character at a time (typewriter), line after line, holds the full list, then
 * loops. Vertically centered via the `.nrCapabilityField` flex container. The
 * card keys this by discipline, so it restarts on every switch. Decorative
 * (the screen is `aria-hidden`). The per-discipline phrases + example mockups
 * live in `expertiseExamples.tsx`.
 */
export function CapabilityList({
  capabilities,
}: {
  capabilities: readonly string[];
}): ReactNode {
  const reduced = usePrefersReducedMotion();
  // `done` = count of fully typed lines; `typed` = chars typed of the line at
  // index `done` (the one currently being written).
  const [done, setDone] = useState(0);
  const [typed, setTyped] = useState(0);

  useEffect(() => {
    if (reduced) return;
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
  }, [done, typed, capabilities, reduced]);

  return (
    <ul className="nrCapList">
      {capabilities.map((item, i) => {
        if (!reduced && i > done) return null;
        const fullyTyped = reduced || i < done;
        const text = fullyTyped ? item : item.slice(0, typed);
        const active = !reduced && i === done && done < capabilities.length;
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
