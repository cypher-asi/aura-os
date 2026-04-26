import { createPortal } from "react-dom";
import { useActiveApp } from "../../hooks/use-active-app";

interface SidekickPortalBridgeProps {
  headerTarget: HTMLDivElement | null;
  panelTarget: HTMLDivElement | null;
}

export function SidekickPortalBridge({
  headerTarget,
  panelTarget,
}: SidekickPortalBridgeProps) {
  const activeApp = useActiveApp();
  const { SidekickPanel, SidekickTaskbar } = activeApp;

  if (!SidekickPanel || !panelTarget) return null;

  return (
    <>
      {SidekickTaskbar && headerTarget
        ? createPortal(<SidekickTaskbar />, headerTarget)
        : null}
      {createPortal(<SidekickPanel />, panelTarget)}
    </>
  );
}
