import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
} from "react";
import {
  AGENT_MODE_DESCRIPTORS,
  AGENT_MODE_ORDER,
  type AgentMode,
} from "../../constants/modes";
import styles from "./ModeSelector.module.css";

export interface ModeSelectorProps {
  selectedMode: AgentMode;
  onChange: (mode: AgentMode) => void;
  /** Optional className appended to the root for layout overrides. */
  className?: string;
  /** Hide the leading "MODE" label (e.g. on very narrow surfaces). */
  hideLabel?: boolean;
}

/**
 * Segmented control rendered as the topmost section of the agent
 * chat input. Exactly one mode is active at a time; selection is
 * keyboard-navigable (Left/Right arrows) and announced as a radio
 * group to assistive tech.
 */
export const ModeSelector = memo(function ModeSelector({
  selectedMode,
  onChange,
  className,
  hideLabel = false,
}: ModeSelectorProps) {
  const buttonRefs = useRef<Record<AgentMode, HTMLButtonElement | null>>({
    code: null,
    plan: null,
    image: null,
    "3d": null,
  });
  const segmentsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const indicatorMetricsRef = useRef<{ x: number; width: number } | null>(null);
  const readyFrameRef = useRef<number | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const syncFrameRef = useRef<number | null>(null);

  const measureIndicator = useCallback((mode: AgentMode) => {
    const btn = buttonRefs.current[mode];
    const wrap = segmentsRef.current;
    if (!btn || !wrap) return null;
    // `position: absolute; left: 0` resolves to the padding edge of the
    // positioned ancestor, while getBoundingClientRect uses the border
    // edge — subtract the wrapper's padding-left so the indicator lines
    // up with the button's actual rendered left.
    const padLeft = parseFloat(getComputedStyle(wrap).paddingLeft) || 0;
    const b = btn.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    return {
      x: b.left - w.left - padLeft,
      width: b.width,
    };
  }, []);

  const writeIndicator = useCallback((metrics: { x: number; width: number }) => {
    const ind = indicatorRef.current;
    if (!ind) return;
    ind.style.transform = `translate3d(${metrics.x}px, 0, 0)`;
    ind.style.width = `${metrics.width}px`;
  }, []);

  const cancelMoveFrame = useCallback(() => {
    if (moveFrameRef.current == null) return;
    cancelAnimationFrame(moveFrameRef.current);
    moveFrameRef.current = null;
  }, []);

  const cancelSyncFrame = useCallback(() => {
    if (syncFrameRef.current == null) return;
    cancelAnimationFrame(syncFrameRef.current);
    syncFrameRef.current = null;
  }, []);

  // Keep measurement writes in the layout phase. On selection changes we
  // preserve the previous pill geometry for the just-committed layout, then
  // move to the new geometry on the next frame so CSS has distinct from/to
  // states to animate.
  useLayoutEffect(() => {
    const ind = indicatorRef.current;
    const target = measureIndicator(selectedMode);
    if (!ind || !target) return;

    cancelMoveFrame();
    cancelSyncFrame();

    const previous = indicatorMetricsRef.current;
    indicatorMetricsRef.current = target;

    if (!previous) {
      ind.dataset.motion = "off";
      writeIndicator(target);
      if (readyFrameRef.current != null) {
        cancelAnimationFrame(readyFrameRef.current);
      }
      readyFrameRef.current = requestAnimationFrame(() => {
        readyFrameRef.current = null;
        const current = indicatorRef.current;
        if (!current) return;
        current.dataset.ready = "true";
        current.dataset.motion = "on";
      });
      return;
    }

    ind.dataset.ready = "true";
    ind.dataset.motion = "off";
    writeIndicator(previous);
    // Force the transition-disabled position to become the start point
    // before enabling motion and writing the target position.
    void ind.offsetWidth;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const current = indicatorRef.current;
      if (!current) return;
      current.dataset.motion = "on";
      writeIndicator(target);
    });
  }, [cancelMoveFrame, cancelSyncFrame, measureIndicator, selectedMode, writeIndicator]);

  useEffect(() => {
    const btn = buttonRefs.current[selectedMode];
    const wrap = segmentsRef.current;
    const ind = indicatorRef.current;
    if (!btn || !wrap || !ind) return;
    const update = () => {
      const metrics = measureIndicator(selectedMode);
      if (!metrics) return;
      const previous = indicatorMetricsRef.current;
      if (previous && previous.x === metrics.x && previous.width === metrics.width) {
        return;
      }
      if (moveFrameRef.current != null) return;
      cancelSyncFrame();
      ind.dataset.motion = "off";
      writeIndicator(metrics);
      indicatorMetricsRef.current = metrics;
      syncFrameRef.current = requestAnimationFrame(() => {
        syncFrameRef.current = null;
        const current = indicatorRef.current;
        if (current) current.dataset.motion = "on";
      });
    };
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(btn);
    ro?.observe(wrap);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
      cancelSyncFrame();
    };
  }, [cancelSyncFrame, measureIndicator, selectedMode, writeIndicator]);

  useEffect(() => {
    return () => {
      if (readyFrameRef.current != null) cancelAnimationFrame(readyFrameRef.current);
      cancelMoveFrame();
      cancelSyncFrame();
    };
  }, [cancelMoveFrame, cancelSyncFrame]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const key = event.key;
      if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
        return;
      }
      event.preventDefault();
      const idx = AGENT_MODE_ORDER.indexOf(selectedMode);
      if (idx < 0) return;
      let nextIdx = idx;
      if (key === "ArrowLeft") nextIdx = (idx - 1 + AGENT_MODE_ORDER.length) % AGENT_MODE_ORDER.length;
      else if (key === "ArrowRight") nextIdx = (idx + 1) % AGENT_MODE_ORDER.length;
      else if (key === "Home") nextIdx = 0;
      else if (key === "End") nextIdx = AGENT_MODE_ORDER.length - 1;
      const nextMode = AGENT_MODE_ORDER[nextIdx];
      onChange(nextMode);
      requestAnimationFrame(() => buttonRefs.current[nextMode]?.focus());
    },
    [onChange, selectedMode],
  );

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  return (
    <div
      className={rootClass}
      role="radiogroup"
      aria-label="Agent mode"
      data-agent-surface="mode-selector"
      data-agent-mode={selectedMode}
      onKeyDown={handleKeyDown}
    >
      {hideLabel ? null : <span className={styles.label}>MODE</span>}
      <div className={styles.segments} ref={segmentsRef}>
        <span aria-hidden className={styles.indicator} ref={indicatorRef} />
        {AGENT_MODE_ORDER.map((mode) => {
          const descriptor = AGENT_MODE_DESCRIPTORS[mode];
          const isActive = mode === selectedMode;
          return (
            <button
              key={mode}
              ref={(node) => {
                buttonRefs.current[mode] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`${descriptor.label} mode`}
              title={descriptor.description}
              tabIndex={isActive ? 0 : -1}
              data-agent-mode-option={mode}
              className={`${styles.segment}${isActive ? ` ${styles.segmentActive}` : ""}`}
              onClick={() => {
                if (!isActive) onChange(mode);
              }}
            >
              {descriptor.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
