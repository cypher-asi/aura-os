import { ButtonWindow } from "@cypher-asi/zui";
import { windowCommand } from "../lib/windowCommand";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";

export function WindowControls() {
  const { features } = useAuraCapabilities();

  if (!features.windowControls) return null;

  return (
    <div className="titlebar-no-drag" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
      <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
      <ButtonWindow action="maximize" size="sm" onClick={() => windowCommand("maximize")} />
      <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
    </div>
  );
}
