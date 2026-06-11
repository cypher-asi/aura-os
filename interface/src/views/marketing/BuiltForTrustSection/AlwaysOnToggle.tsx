import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Plate } from "../../../components/Plate";
import "./AlwaysOnToggle.css";

/**
 * How long the "ON" lettering takes to fade out before it flips to the
 * now-open side and fades back in. Decoupled from the knob's 900ms CSS
 * glide so the label re-enters well before the knob lands ("sooner").
 * Kept in sync with the CSS fade-out duration.
 */
const LABEL_FADE_OUT_MS = 220;

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
  const { t } = useTranslation("marketing");
  // `side` drives the knob and starts sliding immediately on click;
  // `labelSide` lags behind it so the "ON" lettering fades out in place on
  // its original side, then jumps to the now-open side and fades back in
  // once it has faded out (LABEL_FADE_OUT_MS) — sooner than the knob lands.
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
    }, LABEL_FADE_OUT_MS);
  };

  return (
    <div className="alwaysOnStage">
      <button
        type="button"
        className="alwaysOnSocket"
        aria-label={t("alwaysOn.ariaLabel", { defaultValue: "Always on" })}
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
