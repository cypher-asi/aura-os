import { Play, Pause, Square } from "lucide-react";
import { Button } from "@cypher-asi/zui";
import styles from "./ProcessCanvas.module.css";

export function ProcessCanvasFloatingToolbar(props: {
  isRunActive: boolean;
  isEnabled?: boolean;
  onTrigger: () => void;
  onToggle?: () => void;
  onStop?: () => void;
}) {
  const { isRunActive, isEnabled, onTrigger, onToggle = () => undefined, onStop = () => undefined } = props;

  return (
    <div className={styles.floatingToolbar}>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Play size={14} />}
        title={isRunActive ? "Run in progress" : "Trigger"}
        onClick={onTrigger}
        disabled={isRunActive}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={isEnabled ? <Pause size={14} /> : <Play size={14} />}
        title={isEnabled ? "Pause" : "Resume"}
        onClick={onToggle}
      />
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<Square size={14} />}
        title="Stop"
        onClick={onStop}
        disabled={!isRunActive}
      />
    </div>
  );
}
