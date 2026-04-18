import { useCallback, useState } from "react";
import { Button, Input, Text } from "@cypher-asi/zui";
import { FolderOpen, X } from "lucide-react";
import { api } from "../../api/client";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import styles from "./FolderPickerField.module.css";

export interface FolderPickerFieldProps {
  /** Current absolute folder path, or empty string for "use default". */
  value: string;
  /** Called with the new value. Empty string means "clear the override". */
  onChange: (next: string) => void;
  /** Field label. */
  label?: string;
  /**
   * Shown under the input when empty. Typically describes the default
   * location that will be used if no folder is picked.
   */
  defaultHint?: string;
  /** Disable the input + buttons (e.g. while saving). */
  disabled?: boolean;
  /** Aria-label for the text input. Defaults to `label`. */
  inputAriaLabel?: string;
}

/**
 * A reusable folder-picker input that opens a native OS folder dialog when
 * running inside the desktop app, and degrades to a plain text input on the
 * web (where no native picker is available). Always lets the user clear the
 * override with the trailing "x" button so the caller knows to fall back to
 * its default.
 */
export function FolderPickerField({
  value,
  onChange,
  label = "Local folder",
  defaultHint,
  disabled = false,
  inputAriaLabel,
}: FolderPickerFieldProps) {
  const { hasDesktopBridge } = useAuraCapabilities();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = useCallback(async () => {
    if (disabled || picking) return;
    setPicking(true);
    setError(null);
    try {
      const picked = await api.pickFolder();
      if (picked && picked.trim()) {
        onChange(picked.trim());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to pick folder");
    } finally {
      setPicking(false);
    }
  }, [disabled, picking, onChange]);

  const handleClear = useCallback(() => {
    if (disabled) return;
    onChange("");
  }, [disabled, onChange]);

  return (
    <div className={styles.fieldGroup}>
      {label ? (
        <Text size="sm" className={styles.label}>
          {label}
        </Text>
      ) : null}
      <div className={styles.inputRow}>
        <Input
          className={styles.input}
          aria-label={inputAriaLabel ?? label ?? "Local folder"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={defaultHint ?? "Absolute path to a folder"}
          disabled={disabled}
          spellCheck={false}
        />
        {hasDesktopBridge ? (
          <Button
            variant="ghost"
            onClick={handlePick}
            disabled={disabled || picking}
            aria-label="Choose folder"
            className={styles.pickButton}
          >
            <FolderOpen size={14} />
            {picking ? "Picking…" : "Browse"}
          </Button>
        ) : null}
        {value ? (
          <Button
            variant="ghost"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear folder"
            className={styles.clearButton}
          >
            <X size={14} />
          </Button>
        ) : null}
      </div>
      {!value && defaultHint ? (
        <Text variant="muted" size="xs" className={styles.hint}>
          {defaultHint}
        </Text>
      ) : null}
      {!hasDesktopBridge ? (
        <Text variant="muted" size="xs" className={styles.hint}>
          Folder pickers are only available in the Aura desktop app; this
          setting is only applied when the project's agents run on a local
          machine.
        </Text>
      ) : null}
      {error ? (
        <Text size="xs" className={styles.error}>
          {error}
        </Text>
      ) : null}
    </div>
  );
}
