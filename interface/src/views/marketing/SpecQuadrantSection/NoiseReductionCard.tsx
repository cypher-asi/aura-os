import { type ReactNode, useEffect, useRef } from "react";
import { Plate } from "../../../components/Plate";
import { NoiseReductionBrain } from "../NoiseReductionBrain";

/**
 * Mini-UI for the spec bento below `ExpertiseSection`: a static recreation
 * of the reference "DELE" deep-learning noise-reduction plugin. Wrapped in
 * the shared three-ringed `Plate` (matching `ServiceDeviceCard` /
 * `SkillSeaCard`) so it reads as the same hardware family.
 *
 * Top to bottom: a single inset glossy black screen showing the live WebGL
 * `<NoiseReductionBrain />` centered, flanked by black-and-white binary code
 * streaming out on the LEFT (the analytical side) and color photo boxes
 * popping in on the RIGHT (the creative side); that flows seamlessly into the
 * matte LCD body, a status row (ACTIVATION + ONLINE), a large centered knob
 * ringed by a full circle of tick dots and a single pointer, and a caption
 * panel (INTELLIGENCE / WITHOUT LIMITS). Everything is decorative
 * (`aria-hidden`); nothing here is a real control.
 *
 * Moving the cursor anywhere in the viewport is interactive: the cursor's
 * position drives the knob pointer through its dial arc, fills the tick ring
 * up to that point like a level meter, and steers the brain animation.
 */

/** Tick-dot count for the full circular ring around the knob. */
const KNOB_TICKS = 21;

/**
 * Degrees of arc the tick dots span, centered on the top. 240 leaves the
 * bottom third (120 degrees) of the ring empty.
 */
const TICK_ARC_DEG = 240;

/**
 * Assembly instructions interleaved with the binary stream on the left flank
 * so it reads as a live disassembly/listing being written out line by line.
 */
const ASM_LINES = [
  "section .text",
  "global _start",
  "_start:",
  "  mov  rax, 1",
  "  mov  rdi, 1",
  "  lea  rsi, [msg]",
  "  mov  rdx, 13",
  "  syscall",
  "  xor  rax, rax",
  "  push rbp",
  "  mov  rbp, rsp",
  "  sub  rsp, 0x20",
  "  call 0x401130",
  "  add  rsp, 0x20",
  "  cmp  eax, 0x0",
  "  jne  .loop",
  "  test rax, rax",
  "  lea  rdi, [rip+0x2f]",
  "  shl  rbx, 4",
  "  and  rcx, 0xff",
  "  ret",
];

/** Placeholder color photo shown (cropped differently) in each popping box. */
const GALLERY_PHOTO = "/noise-reduction-paint.png";

/**
 * Color photo boxes that pop up on the right half of the screen. Positions
 * and sizes are percentages within the right-half `.nrGallery`; each shows a
 * different crop of the same placeholder photo (`object-position`) and pops
 * on a staggered, looping delay so the half feels alive.
 */
const GALLERY_BOXES = [
  { top: "7%", left: "5%", width: "44%", height: "30%", pos: "0% 0%", delay: 0 },
  {
    top: "9%",
    left: "53%",
    width: "40%",
    height: "27%",
    pos: "100% 0%",
    delay: 0.8,
  },
  {
    top: "41%",
    left: "10%",
    width: "41%",
    height: "31%",
    pos: "15% 55%",
    delay: 1.6,
  },
  {
    top: "39%",
    left: "55%",
    width: "38%",
    height: "35%",
    pos: "85% 45%",
    delay: 2.4,
  },
  {
    top: "74%",
    left: "28%",
    width: "46%",
    height: "23%",
    pos: "50% 100%",
    delay: 3.2,
  },
];

export function NoiseReductionCard(): ReactNode {
  // Shared, normalized (0..1) cursor position. The brain reads this every
  // frame to steer its animation; the knob pointer rotates to match. Kept in
  // a ref so pointer moves don't re-render the card.
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const knobPointerRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const activationRef = useRef<HTMLSpanElement>(null);
  const binaryRef = useRef<HTMLPreElement>(null);

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

  // Assembly + binary "being written" on the left flank: each line types out
  // character by character, then commits and a new line begins — alternating
  // between random binary bytes and assembly mnemonics, like a live listing.
  // Older lines scroll out of a fixed window. A block cursor blinks at the
  // write head. Driven imperatively (no re-render); disabled under
  // reduced-motion.
  useEffect(() => {
    const el = binaryRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = "_start:\n  mov  rax, 1\n01001000 01100101";
      return;
    }
    const ROWS = 15;
    const makeBinary = (): string => {
      const bytes = 1 + Math.floor(Math.random() * 2);
      const parts: string[] = [];
      for (let b = 0; b < bytes; b++) {
        let s = "";
        for (let i = 0; i < 8; i++) s += Math.random() < 0.5 ? "0" : "1";
        parts.push(s);
      }
      return parts.join(" ");
    };
    const nextLine = (): string =>
      Math.random() < 0.5
        ? makeBinary()
        : ASM_LINES[Math.floor(Math.random() * ASM_LINES.length)];

    const committed: string[] = [];
    let current = "";
    let target = nextLine();
    let charIndex = 0;
    let count = 0;
    const id = window.setInterval(() => {
      if (charIndex < target.length) {
        current += target[charIndex];
        charIndex++;
      } else {
        committed.push(current);
        if (committed.length > ROWS) committed.shift();
        current = "";
        target = nextLine();
        charIndex = 0;
      }
      count++;
      const caret = Math.floor(count / 6) % 2 === 0 ? "\u2588" : " ";
      const head = committed.length ? committed.join("\n") + "\n" : "";
      el.textContent = head + current + caret;
    }, 38);
    return () => clearInterval(id);
  }, []);

  // React to the cursor anywhere in the viewport (not just over the device):
  // the window-wide position drives the knob, the tick meter, and the brain
  // animation. A window listener keeps this live regardless of which element
  // the pointer is actually over.
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
          <div className="nrBinary">
            <pre className="nrBinaryText" ref={binaryRef} />
          </div>
          <div className="nrGallery">
            {GALLERY_BOXES.map((box, i) => (
              <div
                key={i}
                className="nrGalleryBox"
                style={{
                  top: box.top,
                  left: box.left,
                  width: box.width,
                  height: box.height,
                  animationDelay: `${box.delay}s`,
                }}
              >
                <img
                  className="nrGalleryPhoto"
                  src={GALLERY_PHOTO}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{ objectPosition: box.pos }}
                />
              </div>
            ))}
          </div>
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
