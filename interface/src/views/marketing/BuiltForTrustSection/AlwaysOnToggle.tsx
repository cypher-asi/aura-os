import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./AlwaysOnToggle.css";

/** Knob slide duration (kept in sync with the CSS transition). */
const SLIDE_MS = 600;

/**
 * Media for the "Always on." trust card: a skeuomorphic toggle switch in
 * the site's dark machined-metal language. Recessed pill socket sunk into
 * the card panel, the shared three-ring `Plate` rim as the metallic bezel,
 * a near-black inner track, and inside it a raised silver knob with
 * gold-glowing "ON" lettering on the open side — the glow slowly breathes
 * but never switches off.
 *
 * The switch is clickable: each click slides the knob to the other side
 * (the "ON" label flips to the now-open side), but it is still lit — the
 * point is that it is "always on" no matter what you click. The knob
 * starts on the left with "ON" on the right.
 */
export function AlwaysOnToggle(): ReactNode {
  // `side` drives the knob and starts sliding immediately on click;
  // `labelSide` lags behind it so the "ON" lettering fades out in place on
  // its original side, and only jumps to the now-open side (and fades back
  // in) once the knob has landed.
  const [side, setSide] = useState<"left" | "right">("left");
  const [labelSide, setLabelSide] = useState<"left" | "right">("left");
  const [labelShown, setLabelShown] = useState(true);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(timerRef.current);
  }, []);

  const toggle = () => {
    window.clearTimeout(timerRef.current);
    const next = side === "left" ? "right" : "left";
    setLabelShown(false);
    setSide(next);
    timerRef.current = window.setTimeout(() => {
      setLabelSide(next);
      setLabelShown(true);
    }, SLIDE_MS);
  };

  return (
    <div className="alwaysOnStage">
      <button
        type="button"
        className="alwaysOnSocket"
        aria-label="Always on"
        onClick={toggle}
      >
        <Plate radius="999px" className="alwaysOnShell">
          <div
            className="alwaysOnTrack"
            data-side={side}
            data-label-side={labelSide}
          >
            <span className="alwaysOnKnob" aria-hidden="true" />
            <span
              className="alwaysOnLabel"
              data-hidden={labelShown ? undefined : "true"}
              aria-hidden="true"
            >
              <span className="alwaysOnLabelText">ON</span>
            </span>
          </div>
        </Plate>
      </button>
    </div>
  );
}
