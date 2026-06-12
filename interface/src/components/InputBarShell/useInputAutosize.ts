import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

/** Tolerance (px) for sub-pixel rounding when comparing the content
 * mirror against the single-line baseline mirror on HiDPI screens. */
const LINE_TOLERANCE_PX = 4;

/**
 * Whether the browser grows the textarea natively via the CSS module's
 * `@supports (field-sizing: content)` opt-in. When it does, this hook
 * never reads or writes layout synchronously — profiling showed the
 * fallback's write → read height pass forces a full-page reflow per
 * keystroke (~16ms on a busy surface), which was the dominant source
 * of typing latency.
 */
function detectNativeAutosize(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("field-sizing", "content")
  );
}

export interface InputAutosizeRefs {
  /** Live textarea (fallback path only: inline `height` kept in sync). */
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * Hidden mirror that renders the current value at the SINGLE-LINE
   * layout's content width (see `.sizeMirror` in the CSS module). Its
   * height answers "does this text wrap in the single-line layout?".
   */
  readonly contentMirrorRef: RefObject<HTMLElement | null>;
  /**
   * Hidden mirror with one-line content; its height is the single-line
   * baseline the content mirror is compared against. Measuring (rather
   * than reading computed line-height) keeps the threshold correct
   * across the pill/default variants and the responsive font sizes.
   */
  readonly baselineMirrorRef: RefObject<HTMLElement | null>;
}

/**
 * Auto-grows the textarea to fit its content and reports whether the
 * prompt has wrapped past one visual line.
 *
 * The multi-line decision is measured on hidden mirror elements that
 * always keep the single-line layout's horizontal insets, regardless of
 * the state the decision drives. Flipping `isMultiLine` (which swaps the
 * real textarea's padding and relocates controls) therefore cannot
 * change the next measurement — oscillation is impossible by
 * construction.
 *
 * Two strategies, picked once per mount:
 * - Native (`field-sizing: content` supported): the browser owns the
 *   textarea height; a ResizeObserver on the mirrors delivers their
 *   post-layout sizes for the wrap decision. Zero forced reflows —
 *   typing costs no synchronous layout work at all.
 * - Fallback: the classic single write → read → write `scrollHeight`
 *   pass per value change, plus re-measures on width/viewport changes.
 */
export function useInputAutosize(
  { textareaRef, contentMirrorRef, baselineMirrorRef }: InputAutosizeRefs,
  value: string,
): boolean {
  const [nativeAutosize] = useState(detectNativeAutosize);
  const [isMultiLine, setIsMultiLine] = useState(false);

  // ── Native path ─────────────────────────────────────────────────
  // The observer fires once on observe (seeding both heights) and then
  // only when a mirror actually changes size — i.e. when the wrap
  // count, font, or available width changes. Entry sizes are computed
  // by the layout pass that already happened, so the callback performs
  // no DOM reads.
  useEffect(() => {
    if (!nativeAutosize) return;
    const content = contentMirrorRef.current;
    const baseline = baselineMirrorRef.current;
    if (!content || !baseline || typeof ResizeObserver === "undefined") {
      return;
    }
    let contentHeight = 0;
    let baselineHeight = 0;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height =
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (entry.target === content) {
          contentHeight = height;
        } else {
          baselineHeight = height;
        }
      }
      const multi =
        baselineHeight > 0 &&
        contentHeight > baselineHeight + LINE_TOLERANCE_PX;
      setIsMultiLine((prev) => (prev === multi ? prev : multi));
    });
    ro.observe(content);
    ro.observe(baseline);
    return () => ro.disconnect();
  }, [nativeAutosize, contentMirrorRef, baselineMirrorRef]);

  // ── Fallback path (no `field-sizing` support) ───────────────────
  const measure = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Write, then batch every read before the final write so the
    // browser runs one synchronous layout for the whole pass.
    el.style.height = "auto";
    // Cap the inline height to match the CSS max-height so the
    // textarea's own scrollbar engages for long messages.
    const cap = Math.min(window.innerHeight * 0.7, 800);
    const naturalHeight = el.scrollHeight;
    const contentHeight = contentMirrorRef.current?.scrollHeight ?? 0;
    const baselineHeight = baselineMirrorRef.current?.scrollHeight ?? 0;
    el.style.height = `${Math.min(naturalHeight, cap)}px`;

    const multi =
      baselineHeight > 0 &&
      contentHeight > baselineHeight + LINE_TOLERANCE_PX;
    setIsMultiLine((prev) => (prev === multi ? prev : multi));
  }, [textareaRef, contentMirrorRef, baselineMirrorRef]);

  // Layout effect so the height is committed before paint — no
  // one-frame flash of a collapsed/overgrown textarea while typing.
  // The multi-line flag can only be derived from a committed layout,
  // so measuring (and the guarded setState inside `measure`) has to
  // live here; the functional no-op setter keeps re-renders limited
  // to actual single↔multi transitions.
  useLayoutEffect(() => {
    if (nativeAutosize) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
  }, [nativeAutosize, measure, value]);

  // Width changes re-wrap the text: window/panel resizes, and the
  // textarea's own padding swap when `data-multiline` flips. The
  // mirror-based decision is deterministic, so the self-induced fire
  // after a state swap simply re-confirms the state (and refreshes the
  // inline height for the new width) instead of bouncing it back.
  useEffect(() => {
    if (nativeAutosize) return;
    const el = textareaRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let lastWidth = el.clientWidth;
    let frame: number | null = null;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (Math.abs(width - lastWidth) <= 0.5) continue;
        lastWidth = width;
        if (frame != null) continue;
        frame = window.requestAnimationFrame(() => {
          frame = null;
          measure();
        });
      }
    });
    ro.observe(el);
    return () => {
      if (frame != null) window.cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [nativeAutosize, measure, textareaRef]);

  // The 70vh height cap tracks the viewport height; width changes are
  // already covered by the ResizeObserver above. (Native path: the CSS
  // `max-height` handles the cap without JS.)
  useEffect(() => {
    if (nativeAutosize) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [nativeAutosize, measure]);

  return isMultiLine;
}
