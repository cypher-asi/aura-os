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
  /** Optional className appended to the row wrapper for layout overrides. */
  className?: string;
  /** Hide the leading "MODE" label (e.g. on very narrow surfaces). */
  hideLabel?: boolean;
}

/**
 * Topmost row of the agent chat input. Owns the row chrome (border,
 * padding, MODE label) and delegates the segmented pill control to
 * the generic `SlidingPills` component, which handles the slide
 * animation, ARIA radiogroup semantics, and keyboard navigation.
 */
export const ModeSelector = memo(function ModeSelector({
  selectedMode,
  onChange,
  className,
  hideLabel = false,
}: ModeSelectorProps) {
  const items = useMemo<readonly SlidingPillItem<AgentMode>[]>(
    () =>
      AGENT_MODE_ORDER.map((mode) => {
        const descriptor = AGENT_MODE_DESCRIPTORS[mode];
        return {
          id: mode,
          label: descriptor.label,
          ariaLabel: `${descriptor.label} mode`,
          title: descriptor.description,
        };
      }),
    [],
  );

  const rootClass = [styles.root, className].filter(Boolean).join(" ");

  return (
    <div
      className={rootClass}
      data-agent-surface="mode-selector"
      data-agent-mode={selectedMode}
    >
      {hideLabel ? null : <span className={styles.label}>MODE</span>}
      <SlidingPills
        items={items}
        value={selectedMode}
        onChange={onChange}
        ariaLabel="Agent mode"
        className={styles.pills}
        segmentClassName={styles.modeSegment}
      />
    </div>
  );
});
