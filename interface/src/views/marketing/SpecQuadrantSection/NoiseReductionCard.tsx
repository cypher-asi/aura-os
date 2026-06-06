import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";

/**
 * Mini-UI for the spec bento below `ExpertiseSection`: a static recreation
 * of the reference "DELE" deep-learning noise-reduction plugin. Wrapped in
 * the shared three-ringed `Plate` (matching `ServiceDeviceCard` /
 * `SkillSeaCard`) so it reads as the same hardware family.
 *
 * Top to bottom: an inset glossy black screen, a header (mic + DELE
 * wordmark, RF mark), a spectrum/wavelength strip of thin bars, a status
 * row (REDUCTION 50% + ACTIVE), and a large centered STRENGTH knob with an
 * arc of tick dots and a single pointer. Everything is decorative
 * (`aria-hidden`); nothing here is a real control.
 */

/** Per-bar heights (0-1) for the spectrum strip; mid bars peak (accent). */
const WAVE_BARS: readonly number[] = [
  0.25, 0.35, 0.3, 0.45, 0.6, 0.4, 0.5, 0.7, 0.85, 0.6, 0.45, 0.65, 0.8, 1, 0.7,
  0.5, 0.6, 0.4, 0.55, 0.7, 0.5, 0.35, 0.45, 0.6, 0.4, 0.3, 0.5, 0.65, 0.45,
  0.3, 0.4, 0.55, 0.7, 0.5, 0.35, 0.45, 0.3, 0.25,
];

/** Tick-dot count around the knob's left-leaning arc. */
const KNOB_TICKS = 13;

export function NoiseReductionCard(): ReactNode {
  return (
    <Plate className="nrCard" aria-hidden="true">
      <div className="nrContent">
        <div className="nrScreen">
          <div className="nrScreenGloss" />
        </div>

        <div className="nrPanel">
          <div className="nrHeader">
            <span className="nrBrand">
              <svg
                className="nrMic"
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="currentColor"
                role="img"
                aria-label="microphone"
              >
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3Z" />
                <path d="M17 11a1 1 0 1 0-2 0 3 3 0 0 1-6 0 1 1 0 1 0-2 0 5 5 0 0 0 4 4.9V18H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-2.1A5 5 0 0 0 17 11Z" />
              </svg>
              <span className="nrWordmark">DELE</span>
            </span>
            <span className="nrLogo">
              R<sup>F</sup>
            </span>
          </div>

          <div className="nrWave">
            {WAVE_BARS.map((h, i) => {
              const isAccent = i > 8 && i < 24;
              return (
                <span
                  key={i}
                  className={isAccent ? "nrWaveBar nrWaveBarAccent" : "nrWaveBar"}
                  style={{ height: `${Math.max(8, h * 100)}%` }}
                />
              );
            })}
          </div>

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
                const angle = -210 + (i / (KNOB_TICKS - 1)) * 150;
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

          <div className="nrCaptions">
            <span className="nrTitle">STRENGTH</span>
            <span className="nrSubtitle">DEEP LEARNING NOISE REDUCTION</span>
          </div>
        </div>
      </div>
    </Plate>
  );
}
