import { Button, ButtonWindow } from "@cypher-asi/zui";
import { PanelRight } from "lucide-react";
import { windowCommand } from "../../lib/windowCommand";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./WindowControls.module.css";

interface WindowControlsProps {
  sidekickCollapsed?: boolean;
  onToggleSidekick?: () => void;
}

export function WindowControls({ sidekickCollapsed, onToggleSidekick }: WindowControlsProps = {}) {
  const { features } = useAuraCapabilities();
  const showSidekickToggle = typeof onToggleSidekick === "function";

  if (!features.windowControls && !showSidekickToggle) return null;

  return (
    <div className={`titlebar-no-drag ${styles.controlRow}`}>
      {showSidekickToggle ? (
        <Button
          variant="ghost"
          size="sm"
          rounded="md"
          iconOnly
          selected={!sidekickCollapsed}
          title="Toggle sidekick"
          aria-label="Toggle sidekick"
          aria-pressed={!sidekickCollapsed}
          className={styles.sidekickToggle}
          onClick={onToggleSidekick}
        >
          <PanelRight size={14} strokeWidth={2} />
        </Button>
      ) : null}
      {features.windowControls ? (
        <>
          <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
          <ButtonWindow action="maximize" size="sm" className={styles.maximizeIcon} onClick={() => windowCommand("maximize")} />
          <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
        </>
      ) : null}
    </div>
  );
}
