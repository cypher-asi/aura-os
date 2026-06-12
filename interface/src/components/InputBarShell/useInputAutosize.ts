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

export interface InputAutosizeRefs {
  /** Live textarea whose inline `height` is kept in sync with content. */
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
 * change the next measurement — the per-keystroke oscillation the old
 * implementation fought with padding simulations and ResizeObserver
 * lockouts is impossible by construction.
 *
 * Per value change this performs a single write → read → write pass on
 * the DOM (one forced layout), instead of the previous up-to-three
 * simulated re-measurements.
 */
export function useInputAutosize(
  { textareaRef, contentMirrorRef, baselineMirrorRef }: InputAutosizeRefs,
  value: string,
): boolean {
  const [isMultiLine, setIsMultiLine] = useState(false);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
  }, [measure, value]);

  // Width changes re-wrap the text: window/panel resizes, and the
  // textarea's own padding swap when `data-multiline` flips. The
  // mirror-based decision is deterministic, so the self-induced fire
  // after a state swap simply re-confirms the state (and refreshes the
  // inline height for the new width) instead of bouncing it back.
  useEffect(() => {
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
  }, [measure, textareaRef]);

  // The 70vh height cap tracks the viewport height; width changes are
  // already covered by the ResizeObserver above.
  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return isMultiLine;
}
