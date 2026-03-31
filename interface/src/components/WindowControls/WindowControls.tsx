import { ButtonWindow } from "@cypher-asi/zui";
import { windowCommand } from "../../lib/windowCommand";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./WindowControls.module.css";

export function WindowControls() {
  const { features } = useAuraCapabilities();

  if (!features.windowControls) return null;

  return (
    <div className={`titlebar-no-drag ${styles.controlRow}`}>
      <ButtonWindow action="minimize" size="sm" onClick={() => windowCommand("minimize")} />
      <ButtonWindow action="maximize" size="sm" className={styles.maximizeIcon} onClick={() => windowCommand("maximize")} />
      <ButtonWindow action="close" size="sm" onClick={() => windowCommand("close")} />
    </div>
  );
}
