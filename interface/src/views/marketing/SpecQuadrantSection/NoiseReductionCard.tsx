import { type PointerEvent, type ReactNode, useCallback, useRef } from "react";
import { Plate } from "../../../components/Plate";
import { NoiseReductionBrain } from "../NoiseReductionBrain";

/**
 * Mini-UI for the spec bento below `ExpertiseSection`: a static recreation
 * of the reference "DELE" deep-learning noise-reduction plugin. Wrapped in
 * the shared three-ringed `Plate` (matching `ServiceDeviceCard` /
 * `SkillSeaCard`) so it reads as the same hardware family.
 *
 * Top to bottom: a single inset glossy black screen (showing a live WebGL
 * brain-scan animation, `<NoiseReductionBrain />`, over a static fallback
 * image) that flows seamlessly into the matte LCD body, a
 * status row (REDUCTION 50% + ACTIVE), a large centered knob ringed by a
 * full circle of tick dots and a single pointer, and a caption panel
 * (INTELLIGENCE / WITHOUT LIMITS). Everything is decorative
 * (`aria-hidden`); nothing here is a real control.
 *
 * Moving the cursor anywhere across the device panel is interactive: the
 * horizontal position sweeps the knob pointer through its dial arc and
 * steers the underlying brain animation (`<NoiseReductionBrain />`). The
 * last position is held when the cursor leaves.
 */

/** Tick-dot count for the full circular ring around the knob. */
const KNOB_TICKS = 21;

/**
 * Degrees of arc the tick dots span, centered on the top. 240 leaves the
 * bottom third (120 degrees) of the ring empty.
 */
const TICK_ARC_DEG = 240;

export function NoiseReductionCard(): ReactNode {
  // Shared, normalized (0..1) cursor position over the panel. The brain
  // reads this every frame to steer its animation; the knob pointer rotates
  // to match. Kept in a ref so pointer moves don't re-render the card.
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const knobPointerRef = useRef<HTMLSpanElement>(null);

  const handlePointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    pointerRef.current = { x, y };
    // Sweep the pointer through the dial's arc: left = min, right = max.
    const angle = (x - 0.5) * TICK_ARC_DEG;
    knobPointerRef.current?.style.setProperty("--nr-knob-angle", `${angle}deg`);
  }, []);

  return (
    <Plate className="nrCard" aria-hidden="true">
      <div className="nrContent" onPointerMove={handlePointerMove}>
        <div className="nrScreen">
          <img
            className="nrScreenImage"
            src="/noise-reduction-brain.png"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <NoiseReductionBrain className="nrScreenBrain" pointerRef={pointerRef} />
          <div className="nrScreenGloss" />
        </div>

        <div className="nrPanel">
          <div className="nrControls">
            <div className="nrStatus">
              <span className="nrReduction">
                <span className="nrReductionLabel">REDUCTION</span>
                <span className="nrReductionValue">50%</span>
              </span>
              <span className="nrActive">
                <span className="nrActiveDot" />
                ACTIVE
              </span>
            </div>

            <div className="nrKnobWrap">
              <div className="nrKnobTicks">
                {Array.from({ length: KNOB_TICKS }).map((_, i) => {
                  const angle =
                    -TICK_ARC_DEG / 2 +
                    (i / (KNOB_TICKS - 1)) * TICK_ARC_DEG;
                  return (
                    <span
                      key={i}
                      className="nrKnobTick"
                      style={{
                        transform: `rotate(${angle}deg) translateY(calc(var(--nr-knob-size) / -2 - 12px))`,
                      }}
                    />
                  );
                })}
              </div>
              <div className="nrKnob">
                <span className="nrKnobPointer" ref={knobPointerRef} />
              </div>
            </div>

            <div className="nrCaption">
              <span className="nrCaptionTitle">INTELLIGENCE</span>
              <span className="nrCaptionSub">WITHOUT LIMITS</span>
            </div>
          </div>
        </div>
      </div>
    </Plate>
  );
}
