import { memo, useMemo } from "react";
import {
  AGENT_MODE_DESCRIPTORS,
  AGENT_MODE_ORDER,
  type AgentMode,
} from "../../constants/modes";
import { SlidingPills, type SlidingPillItem } from "../SlidingPills";
import styles from "./ModeSelector.module.css";

export interface ModeSelectorProps {
  selectedMode: AgentMode;
  onChange: (mode: AgentMode) => void;
  /** Optional hook for demo surfaces that need active-mode re-clicks. */
  onSelect?: (mode: AgentMode) => void;
  /**
   * Optional visible labels for contexts that present the same wire mode
   * differently.
   */
  labels?: Partial<Record<AgentMode, string>>;
  /** Optional className appended to the row wrapper for layout overrides. */
  className?: string;
}

/**
 * Topmost row of the agent chat input. Owns the row chrome (border,
 * padding) and delegates the segmented pill control to the generic
 * `SlidingPills` component, which handles the slide animation, ARIA
 * radiogroup semantics, and keyboard navigation.
 */
export const ModeSelector = memo(function ModeSelector({
  selectedMode,
  onChange,
  onSelect,
  labels,
  className,
}: ModeSelectorProps) {
  const items = useMemo<readonly SlidingPillItem<AgentMode>[]>(
    () =>
      AGENT_MODE_ORDER.map((mode) => {
        const descriptor = AGENT_MODE_DESCRIPTORS[mode];
        const label = labels?.[mode] ?? descriptor.label;
        return {
          id: mode,
          label,
          ariaLabel: `${label} mode`,
          title: descriptor.description,
        };
      }),
    [labels],
  );

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  return (
    <div
      className={rootClass}
      data-agent-surface="mode-selector"
      data-agent-mode={selectedMode}
    >
      <div className={styles.outerCapsule}>
        <SlidingPills
          items={items}
          value={selectedMode}
          onChange={onChange}
          onSelect={onSelect}
          ariaLabel="Agent mode"
          className={styles.pills}
          segmentClassName={styles.modeSegment}
          indicatorClassName={styles.modeIndicator}
        />
      </div>
    </div>
  );
});
