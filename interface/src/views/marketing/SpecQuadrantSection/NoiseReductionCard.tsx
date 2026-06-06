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
 * `<NoiseReductionBrain />` centered, flanked by two living halves: the LEFT
 * (the analytical side) shows many small code snippets typing themselves out
 * (a bit of assembler followed by binary) and popping in/out at staggered,
 * desynced positions, like intense rational work happening across many
 * instances; the RIGHT (the creative side) shows assorted images popping in
 * and out at randomized, unpredictable positions, sizes, and timing. That
 * flows seamlessly into the matte LCD body, a status row (ACTIVATION +
 * ONLINE), a large centered knob ringed by a full circle of tick dots and a
 * single pointer, and a caption panel (INTELLIGENCE / WITHOUT LIMITS).
 * Everything is decorative (`aria-hidden`); nothing here is a real control.
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
 * Assembly instructions interleaved with binary in the left-flank snippets so
 * each one reads as a live disassembly/listing being written out.
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

/** One space-separated line of 1-2 random binary bytes. */
function makeBinary(): string {
  const bytes = 1 + Math.floor(Math.random() * 2);
  const parts: string[] = [];
  for (let b = 0; b < bytes; b++) {
    let s = "";
    for (let i = 0; i < 8; i++) s += Math.random() < 0.5 ? "0" : "1";
    parts.push(s);
  }
  return parts.join(" ");
}

/**
 * Build one short snippet: a couple assembler lines followed by a couple
 * binary lines, so it reads as "assembler then the bits it compiles to".
 */
function makeSnippet(): string {
  const lines: string[] = [];
  const asmCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < asmCount; i++) {
    lines.push(ASM_LINES[Math.floor(Math.random() * ASM_LINES.length)]);
  }
  const binCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < binCount; i++) lines.push(makeBinary());
  return lines.join("\n");
}

/**
 * Candidate positions (percent of the left flank) the snippet cards hop
 * between as they pop in and out. More slots than cards so re-entry can pick a
 * fresh, currently-unoccupied spot.
 */
const CODE_SLOTS = [
  { top: "5%", left: "8%", width: "82%" },
  { top: "24%", left: "3%", width: "74%" },
  { top: "33%", left: "22%", width: "70%" },
  { top: "47%", left: "10%", width: "80%" },
  { top: "63%", left: "2%", width: "72%" },
  { top: "79%", left: "16%", width: "76%" },
];

/** How many snippet cards live (and pop in/out) on the left flank at once. */
const SNIPPET_COUNT = 4;

/** Assorted images that pop in/out on the creative right flank. */
const GALLERY_IMAGES = [
  "/noise-reduction-paint.png",
  "/noise-reduction-brain.png",
  "/noise-reduction-code.png",
  "/personas/researcher/site.png",
  "/personas/vibecoder/site.png",
];

/** How many image boxes pop in/out on the right flank. */
const GALLERY_COUNT = 7;

/** Lifecycle phases for a single left-flank snippet card. */
type SnippetPhase = "wait" | "enter" | "typing" | "hold" | "exit";

interface SnippetState {
  phase: SnippetPhase;
  slot: number;
  text: string;
  typed: number;
  ticks: number;
}

/** Position a snippet card over one of the `CODE_SLOTS`. */
function applySlot(card: HTMLDivElement, slot: (typeof CODE_SLOTS)[number]): void {
  card.style.top = slot.top;
  card.style.left = slot.left;
  card.style.width = slot.width;
}

/** Drop an image box at a random spot/size with a random image + crop. */
function randomizeBox(box: HTMLDivElement, img: HTMLImageElement): void {
  img.src = GALLERY_IMAGES[Math.floor(Math.random() * GALLERY_IMAGES.length)];
  img.style.objectPosition = `${Math.floor(Math.random() * 100)}% ${Math.floor(
    Math.random() * 100,
  )}%`;
  box.style.top = `${2 + Math.random() * 64}%`;
  box.style.left = `${Math.random() * 52}%`;
  box.style.width = `${30 + Math.random() * 18}%`;
  box.style.height = `${22 + Math.random() * 16}%`;
}

export function NoiseReductionCard(): ReactNode {
  // Shared, normalized (0..1) cursor position. The brain reads this every
  // frame to steer its animation; the knob pointer rotates to match. Kept in
  // a ref so pointer moves don't re-render the card.
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const knobPointerRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const activationRef = useRef<HTMLSpanElement>(null);
  const snippetCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const snippetPreRefs = useRef<(HTMLPreElement | null)[]>([]);
  const galleryBoxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const galleryImgRefs = useRef<(HTMLImageElement | null)[]>([]);

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

  // Left flank: many small snippet cards, each running an independent
  // enter -> type (asm then binary) -> hold -> exit -> wait loop. Slots and
  // start offsets are randomized so they desync, reading like lots of separate
  // instances working at once. Driven imperatively (no re-render); animates
  // unconditionally to match the always-on brain + ACTIVATION readout.
  useEffect(() => {
    const cards = snippetCardRefs.current;
    const pres = snippetPreRefs.current;
    if (!cards.length) return;

    const occupied = new Set<number>();
    const pickSlot = (): number => {
      const free = CODE_SLOTS.map((_, i) => i).filter((i) => !occupied.has(i));
      const pool = free.length ? free : CODE_SLOTS.map((_, i) => i);
      const idx = pool[Math.floor(Math.random() * pool.length)];
      occupied.add(idx);
      return idx;
    };

    const states: SnippetState[] = cards.map(() => ({
      phase: "wait",
      slot: -1,
      text: "",
      typed: 0,
      ticks: Math.floor(Math.random() * 36),
    }));

    let frame = 0;
    const id = window.setInterval(() => {
      frame++;
      const caret = Math.floor(frame / 8) % 2 === 0 ? "\u2588" : " ";
      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        const card = cards[i];
        const pre = pres[i];
        if (!card || !pre) continue;
        switch (s.phase) {
          case "wait":
            if (--s.ticks <= 0) s.phase = "enter";
            break;
          case "enter": {
            s.slot = pickSlot();
            applySlot(card, CODE_SLOTS[s.slot]);
            s.text = makeSnippet();
            s.typed = 0;
            pre.textContent = caret;
            card.style.opacity = "0";
            card.style.transform = "translateY(6px) scale(0.96)";
            // Next frame: let the transition fade/slide it in.
            requestAnimationFrame(() => {
              card.style.opacity = "1";
              card.style.transform = "translateY(0) scale(1)";
            });
            s.phase = "typing";
            break;
          }
          case "typing": {
            if (s.typed < s.text.length) {
              s.typed += 1;
            } else {
              s.phase = "hold";
              s.ticks = 28 + Math.floor(Math.random() * 24);
            }
            pre.textContent = s.text.slice(0, s.typed) + caret;
            break;
          }
          case "hold": {
            pre.textContent = s.text + caret;
            if (--s.ticks <= 0) {
              s.phase = "exit";
              s.ticks = 9;
              card.style.opacity = "0";
              card.style.transform = "translateY(-6px) scale(0.96)";
            }
            break;
          }
          case "exit": {
            if (--s.ticks <= 0) {
              occupied.delete(s.slot);
              s.phase = "wait";
              s.ticks = Math.floor(Math.random() * 28);
            }
            break;
          }
        }
      }
    }, 42);
    return () => clearInterval(id);
  }, []);

  // Right flank: image boxes that pop in/out via the CSS `nrPop` keyframe, each
  // on its own randomized duration/phase so they drift apart. On every cycle
  // (`animationiteration`, fired while the box is invisible) the box re-rolls
  // its image, position, size, and crop for an unpredictable, creative feel.
  // Animates unconditionally to match the always-on brain + ACTIVATION readout.
  useEffect(() => {
    const boxes = galleryBoxRefs.current;
    const imgs = galleryImgRefs.current;
    boxes.forEach((box, i) => {
      const img = imgs[i];
      if (box && img) randomizeBox(box, img);
    });

    const cleanups: Array<() => void> = [];
    boxes.forEach((box, i) => {
      const img = imgs[i];
      if (!box || !img) return;
      const dur = 3.4 + Math.random() * 3;
      box.style.animationDuration = `${dur}s`;
      box.style.animationDelay = `${-(Math.random() * dur)}s`;
      const onIter = () => randomizeBox(box, img);
      box.addEventListener("animationiteration", onIter);
      cleanups.push(() => box.removeEventListener("animationiteration", onIter));
    });
    return () => cleanups.forEach((fn) => fn());
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
          <div className="nrCodeField">
            {Array.from({ length: SNIPPET_COUNT }).map((_, i) => (
              <div
                key={i}
                className="nrCodeSnippet"
                ref={(el) => {
                  snippetCardRefs.current[i] = el;
                }}
              >
                <pre
                  className="nrBinaryText"
                  ref={(el) => {
                    snippetPreRefs.current[i] = el;
                  }}
                />
              </div>
            ))}
          </div>
          <div className="nrGallery">
            {Array.from({ length: GALLERY_COUNT }).map((_, i) => (
              <div
                key={i}
                className="nrGalleryBox"
                ref={(el) => {
                  galleryBoxRefs.current[i] = el;
                }}
              >
                <img
                  className="nrGalleryPhoto"
                  ref={(el) => {
                    galleryImgRefs.current[i] = el;
                  }}
                  alt=""
                  loading="lazy"
                  decoding="async"
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
