import { Lane, type LaneResizeControls } from "../Lane";
import {
  SIDEKICK_MAX_WIDTH,
  SIDEKICK_MIN_WIDTH,
} from "./desktop-shell-sidekick";
import styles from "./DesktopShell.module.css";

interface PersistentSidekickLaneProps {
  resizeControlsRef?: { current: LaneResizeControls | null };
  collapsed: boolean;
  defaultWidth: number;
  showHeaderSlot: boolean;
  onResizeEnd: (size: number) => void;
  onHeaderTargetChange: (node: HTMLDivElement | null) => void;
  onPanelTargetChange: (node: HTMLDivElement | null) => void;
}

export function PersistentSidekickLane({
  resizeControlsRef,
  collapsed,
  defaultWidth,
  showHeaderSlot,
  onResizeEnd,
  onHeaderTargetChange,
  onPanelTargetChange,
}: PersistentSidekickLaneProps) {
  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={defaultWidth}
      minWidth={SIDEKICK_MIN_WIDTH}
      maxWidth={SIDEKICK_MAX_WIDTH}
      storageKey={null}
      collapsible
      collapsed={collapsed}
      animateResizeRelease={false}
      resizeControlsRef={resizeControlsRef}
      onResizeEnd={onResizeEnd}
      className={styles.sidekickLane}
      header={
        showHeaderSlot ? (
          <div
            ref={onHeaderTargetChange}
            className={styles.sidekickHeaderSlot}
            data-agent-surface="sidekick-header"
            aria-label="Sidekick header"
          />
        ) : undefined
      }
    >
      <div className={styles.sidekickPanels}>
        <div
          ref={onPanelTargetChange}
          className={styles.sidekickPanelSlot}
          data-agent-surface="sidekick-panel"
          aria-label="Sidekick panel"
        />
      </div>
    </Lane>
  );
}
