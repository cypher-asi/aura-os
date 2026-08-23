import { memo } from "react";
import { Mic, Square } from "lucide-react";
import styles from "./VoiceDictationControl.module.css";

interface VoiceDictationControlProps {
  supported: boolean;
  listening: boolean;
  error: string | null;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}

export const VoiceDictationControl = memo(function VoiceDictationControl({
  supported,
  listening,
  error,
  disabled = false,
  onToggle,
  className,
}: VoiceDictationControlProps) {
  if (!supported) return null;
  const label = listening ? "Stop voice dictation" : "Start voice dictation";
  return (
    <button
      type="button"
      className={`${styles.button} ${listening ? styles.listening : ""} ${className ?? ""}`}
      onClick={onToggle}
      disabled={disabled}
      aria-label={label}
      aria-pressed={listening}
      title={error ?? label}
      data-agent-action="voice-dictation"
    >
      {listening ? (
        <Square size={11} fill="currentColor" aria-hidden="true" />
      ) : (
        <Mic size={16} aria-hidden="true" />
      )}
      <span className={styles.srOnly} aria-live="polite">
        {error ?? (listening ? "Listening. Review the transcript before sending." : "")}
      </span>
    </button>
  );
});
