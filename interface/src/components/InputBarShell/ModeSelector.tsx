import {
  memo,
  useCallback,
  useRef,
  type CSSProperties,
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
 *
 * The active pill is positioned by CSS only: segments are laid out
 * as equal-width grid columns and a single indicator child is
 * translated by `--mode-idx`, which the React layer just reads off
 * the active mode's index. There is no measurement, no ref-driven
 * animation, and no JS animation — a single CSS transition owns the
 * motion, so it cannot be raced by React/effect timing or a global
 * `transition: none` guard from a sibling component.
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

  const activeIndex = Math.max(0, AGENT_MODE_ORDER.indexOf(selectedMode));

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
  const segmentsStyle = {
    "--mode-idx": activeIndex,
    "--mode-count": AGENT_MODE_ORDER.length,
  } as CSSProperties;

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
      <div className={styles.segments} style={segmentsStyle}>
        <span aria-hidden className={styles.indicator} />
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
