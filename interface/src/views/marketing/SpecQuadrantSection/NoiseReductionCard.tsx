import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";

/**
 * Mini-UI for the spec bento below `ExpertiseSection`: a static recreation
 * of the reference "DELE" deep-learning noise-reduction plugin. Wrapped in
 * the shared three-ringed `Plate` (matching `ServiceDeviceCard` /
 * `SkillSeaCard`) so it reads as the same hardware family.
 *
 * Top to bottom: a single inset glossy black screen (showing a glowing
 * brain-scan visual) that flows seamlessly into the matte LCD body, a
 * status row (REDUCTION 50% + ACTIVE), a large centered knob ringed by a
 * full circle of tick dots and a single pointer, and a caption panel
 * (STRENGTH / DEEP LEARNING NOISE REDUCTION). Everything is decorative
 * (`aria-hidden`); nothing here is a real control.
 */

/** Tick-dot count for the full circular ring around the knob. */
const KNOB_TICKS = 21;

/**
 * Degrees of arc the tick dots span, centered on the top. 240 leaves the
 * bottom third (120 degrees) of the ring empty.
 */
const TICK_ARC_DEG = 240;

export function NoiseReductionCard(): ReactNode {
  return (
    <Plate className="nrCard" aria-hidden="true">
      <div className="nrContent">
        <div className="nrScreen">
          <img
            className="nrScreenImage"
            src="/noise-reduction-brain.png"
            alt=""
            loading="lazy"
            decoding="async"
          />
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
                <span className="nrKnobPointer" />
              </div>
            </div>

            <div className="nrCaption">
              <span className="nrCaptionTitle">STRENGTH</span>
              <span className="nrCaptionSub">DEEP LEARNING NOISE REDUCTION</span>
            </div>
          </div>
        </div>
      </div>
    </Plate>
  );
}
