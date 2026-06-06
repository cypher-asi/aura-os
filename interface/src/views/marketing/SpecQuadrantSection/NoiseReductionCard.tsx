import { type ReactNode, useEffect, useRef } from "react";
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
 * Moving the cursor anywhere in the viewport is interactive: the cursor's
 * horizontal position across the window sweeps the knob pointer through its
 * dial arc, fills the tick ring up to that point like a level meter, and
 * steers the underlying brain animation (`<NoiseReductionBrain />`).
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
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const activationRef = useRef<HTMLSpanElement>(null);

  // Live ACTIVATION readout: a number floored at 0.01 that rapidly rises and
  // falls. Updated imperatively each frame (no re-render) so the digits flicker
  // like a busy live meter.
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const wave = 0.5 + 0.5 * Math.sin(t * 5.0) * Math.sin(t * 1.7 + 0.6);
      const jitter = Math.sin(t * 37.0) * 0.06;
      const value = Math.max(0.01, wave * 2.4 + jitter);
      if (activationRef.current) {
        activationRef.current.textContent = value.toFixed(2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // React to the cursor anywhere in the viewport (not just over the device):
  // the window-wide horizontal position drives the knob, the tick meter, and
  // the brain animation. A window listener keeps this live regardless of
  // which element the pointer is actually over.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const x = Math.min(1, Math.max(0, e.clientX / w));
      const y = Math.min(1, Math.max(0, e.clientY / h));
      pointerRef.current = { x, y };
      // Sweep the pointer through the dial's arc: left = min, right = max.
      const angle = (x - 0.5) * TICK_ARC_DEG;
      knobPointerRef.current?.style.setProperty(
        "--nr-knob-angle",
        `${angle}deg`,
      );
      // Light every tick from the start of the arc up to the pointer, like a
      // level meter filling in real time. Tick `i` sits at `i/(N-1)` of the
      // arc, so it's lit once that fraction is <= the cursor's x position.
      const litThreshold = x * (KNOB_TICKS - 1);
      for (let i = 0; i < tickRefs.current.length; i++) {
        tickRefs.current[i]?.classList.toggle(
          "nrKnobTickLit",
          i <= litThreshold,
        );
      }
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Default fill matches the rest pointer (straight up = cursor centered):
  // ticks in the left half plus the top tick start lit.
  const defaultLitMax = (KNOB_TICKS - 1) / 2;

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
          <NoiseReductionBrain className="nrScreenBrain" pointerRef={pointerRef} />
          <div className="nrScreenGloss" />
        </div>

        <div className="nrPanel">
          <div className="nrControls">
            <div className="nrStatus">
              <span className="nrReduction">
                <span className="nrReductionLabel">ACTIVATION</span>
                <span className="nrReductionValue" ref={activationRef}>
                  0.01
                </span>
              </span>
              <span className="nrActive">
                <span className="nrActiveDot" />
                ONLINE
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
                      ref={(el) => {
                        tickRefs.current[i] = el;
                      }}
                      className={
                        i <= defaultLitMax
                          ? "nrKnobTick nrKnobTickLit"
                          : "nrKnobTick"
                      }
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
