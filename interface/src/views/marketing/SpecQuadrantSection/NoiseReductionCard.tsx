import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { Plate } from "../../../components/Plate";
import { SlidingPills, type SlidingPillItem } from "../../../components/SlidingPills";
import { NoiseReductionBrain } from "../NoiseReductionBrain";
import { CapabilityList } from "./expertiseContent";
import {
  EXAMPLE_COMPONENTS,
  EXPERTISE_CAPABILITIES,
  EXPERTISES,
  type Expertise,
} from "./expertiseExamples";

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
 * single pointer, and — below the knob — a set-in pill selector for the
 * active discipline. The INTELLIGENCE / WITHOUT LIMITS caption is seated
 * above the chassis (mirroring the made-for-you device caption). Everything
 * but the discipline selector is decorative (`aria-hidden`).
 *
 * The selector defaults to `General`, which renders the looping code (left)
 * and image (right) flanks; switching to any other discipline renders that
 * discipline's typewriter capability list (left) and example mockup (right)
 * around the same centered brain (see `expertiseContent.tsx`).
 *
 * The knob is driven by the cursor's vertical position in the viewport: the
 * top reads 0 (pointer hard left), the center reads 50% (pointer straight up),
 * the bottom reads max (pointer hard right), and the tick ring fills up to that
 * point like a level meter. The brain animation is ambient and not affected by
 * the cursor.
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
 * Fixed, evenly spaced rows (percent of the left flank) — one per snippet
 * card. Each card stays in its own row so snippets never overlap and the flank
 * reads as a structured, aligned listing.
 */
const CODE_SLOTS = [
  { top: "6%", left: "10%", width: "80%" },
  { top: "31%", left: "10%", width: "80%" },
  { top: "56%", left: "10%", width: "80%" },
  { top: "80%", left: "10%", width: "80%" },
];

/** How many snippet cards live (and pop in/out) on the left flank at once. */
const SNIPPET_COUNT = CODE_SLOTS.length;

/**
 * Images that pop in/out on the creative right flank. Just the painting photo
 * as a placeholder for now (different crops per box keep it varied).
 */
const GALLERY_IMAGES = ["/noise-reduction-paint.png"];

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
  const knobPointerRef = useRef<HTMLSpanElement>(null);
  const tickRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const activationRef = useRef<HTMLSpanElement>(null);
  const snippetCardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const snippetPreRefs = useRef<(HTMLPreElement | null)[]>([]);
  const galleryBoxRefs = useRef<(HTMLDivElement | null)[]>([]);
  const galleryImgRefs = useRef<(HTMLImageElement | null)[]>([]);

  // Selected discipline. `General` (first) is the default and renders the
  // bespoke code (left) / paint (right) flanks. Every other discipline renders
  // a typewriter capability list (left) + an example mockup (right) around the
  // same centered brain (see `expertiseContent.tsx`).
  const { t } = useTranslation("marketing");
  // On phones/tablets the WebGL brain is removed: it's the heaviest visual
  // in the card and reads as clutter at that size, so we skip mounting it
  // entirely (no canvas, no render loop) rather than just hiding it.
  const { isMobileLayout } = useAuraCapabilities();
  const [expertise, setExpertise] = useState<Expertise>("General");
  const showGeneralFlanks = expertise === "General";
  // Narrow away `General` so the per-discipline content maps stay strongly
  // typed; `null` while General is active.
  const specialized = expertise === "General" ? null : expertise;
  const ExampleMockup = specialized ? EXAMPLE_COMPONENTS[specialized] : null;
  // Discipline pill labels and the capability list are resolved through the
  // marketing catalog (keyed by lowercased discipline); fall back to the
  // hardcoded English when a key is missing.
  const expertisePills: readonly SlidingPillItem<Expertise>[] = EXPERTISES.map(
    (label) => ({
      id: label,
      label: t(`disciplines.${label.toLowerCase()}`, { defaultValue: label }),
    }),
  );
  const specializedCapabilities = specialized
    ? EXPERTISE_CAPABILITIES[specialized].map((capability, index) =>
        t(`capabilities.${specialized.toLowerCase()}.${index}`, {
          defaultValue: capability,
        }),
      )
    : [];

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

  // Left flank: one snippet card per fixed row, each running an independent
  // enter -> type (asm then binary) -> hold -> exit -> wait loop. Cards stay in
  // their own row (no overlap) but start offsets are randomized so they desync,
  // reading like several instances working in parallel. Driven imperatively (no
  // re-render); animates unconditionally to match the always-on brain readout.
  useEffect(() => {
    // Only the `General` discipline renders the code flank; other
    // disciplines mount blank flanks (no cards), so skip the loop.
    if (!showGeneralFlanks) return;
    const cards = snippetCardRefs.current;
    const pres = snippetPreRefs.current;
    if (!cards.length) return;

    cards.forEach((card, i) => {
      if (card) applySlot(card, CODE_SLOTS[i]);
    });

    const states: SnippetState[] = cards.map((_, i) => ({
      phase: "wait",
      slot: i,
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
              s.phase = "wait";
              s.ticks = Math.floor(Math.random() * 28);
            }
            break;
          }
        }
      }
    }, 42);
    return () => clearInterval(id);
  }, [showGeneralFlanks]);

  // Right flank: image boxes that pop in/out via the CSS `nrPop` keyframe, each
  // on its own randomized duration/phase so they drift apart. On every cycle
  // (`animationiteration`, fired while the box is invisible) the box re-rolls
  // its image, position, size, and crop for an unpredictable, creative feel.
  // Animates unconditionally to match the always-on brain + ACTIVATION readout.
  useEffect(() => {
    if (!showGeneralFlanks) return;
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
  }, [showGeneralFlanks]);

  // Drive the knob from the cursor's vertical position anywhere in the
  // viewport: top of the viewport reads 0 (pointer hard left), the vertical
  // center reads 50% (pointer straight up), the bottom reads max (pointer hard
  // right). The tick ring fills like a level meter to match. A window listener
  // keeps this live regardless of which element the pointer is over; written
  // imperatively so it never re-renders the card.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const h = window.innerHeight || 1;
      // 0 at the top of the viewport, 1 at the bottom, 0.5 at the center.
      const v = Math.min(1, Math.max(0, e.clientY / h));
      const angle = (v - 0.5) * TICK_ARC_DEG;
      knobPointerRef.current?.style.setProperty(
        "--nr-knob-angle",
        `${angle}deg`,
      );
      // Tick `i` sits at `i/(N-1)` of the arc, so it's lit once that fraction
      // is <= the cursor's vertical position.
      const litThreshold = v * (KNOB_TICKS - 1);
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

  // First-paint fill before the cursor moves: assume the 50% midpoint (ticks
  // in the left half plus the top tick start lit).
  const defaultLitMax = (KNOB_TICKS - 1) / 2;

  return (
    <div className="nrStage">
      {/* Section caption seated above the chassis (mirrors the
          "CONFIGURE / YOUR PRIVATE AGENT" caption above the made-for-you
          device), lifted out of the device's control panel. */}
      <div className="nrCaption" aria-hidden="true">
        <span className="nrCaptionTitle">
          {t("specQuadrant.intelligence", { defaultValue: "INTELLIGENCE" })}
        </span>
        <span className="nrCaptionSub">
          {t("specQuadrant.withoutLimits", { defaultValue: "WITHOUT LIMITS" })}
        </span>
      </div>

      <Plate className="nrCard">
        <div className="nrContent">
          <div className="nrScreen" aria-hidden="true">
            {showGeneralFlanks ? (
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
            ) : null}
            {showGeneralFlanks ? (
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
            ) : null}
            {/* Specialized disciplines: typewriter capability list (left) and
                an example mockup (right) flanking the centered brain. Keyed by
                discipline so the typewriter restarts on every switch. */}
            {specialized ? (
              <div className="nrCapabilityField">
                <CapabilityList
                  key={specialized}
                  capabilities={specializedCapabilities}
                />
              </div>
            ) : null}
            {ExampleMockup ? (
              <div className="nrExampleField">
                <ExampleMockup />
              </div>
            ) : null}
            {isMobileLayout ? null : (
              <NoiseReductionBrain className="nrScreenBrain" />
            )}
            <div className="nrScreenGloss" />
          </div>

          <div className="nrPanel">
            <div className="nrControls">
              {/* ACTIVATION / ONLINE readout, seated in the dark band just
                  above the lighter controls/pill plate, flanking the knob. */}
              <div className="nrStatus" aria-hidden="true">
                <span className="nrReduction">
                  <span className="nrReductionLabel">
                    {t("specQuadrant.activation", { defaultValue: "ACTIVATION" })}
                  </span>
                  <span className="nrReductionValue" ref={activationRef}>
                    0.01
                  </span>
                </span>
                <span className="nrActive">
                  <span className="nrActiveDot" />
                  {t("specQuadrant.online", { defaultValue: "ONLINE" })}
                </span>
              </div>

              <div className="nrKnobWrap" aria-hidden="true">
                <div className="nrKnobTicks">
                  {Array.from({ length: KNOB_TICKS }).map((_, i) => {
                    // Drop the two arc endpoints (the bottom-left and
                    // bottom-right dots) while keeping every other dot in place.
                    if (i === 0 || i === KNOB_TICKS - 1) {
                      return null;
                    }
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

              {/* Set-in pill selector (mirrors the mode selector capsule):
                  picks the discipline whose side-flank content shows. */}
              <div className="nrExpertise">
                <div className="nrExpertiseCapsule">
                  <SlidingPills
                    items={expertisePills}
                    value={expertise}
                    onChange={setExpertise}
                    ariaLabel={t("specQuadrant.expertiseAria", {
                      defaultValue: "Expertise",
                    })}
                    className="nrExpertisePills"
                    segmentClassName="nrExpertiseSegment"
                    indicatorClassName="nrExpertiseIndicator"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </Plate>
    </div>
  );
}
