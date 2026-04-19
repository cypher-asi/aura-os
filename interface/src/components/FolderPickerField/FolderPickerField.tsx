import { useCallback, useState } from "react";
import { Text } from "@cypher-asi/zui";
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
   * The actual default path that will be used when no override is set. When
   * provided, the field renders this path in muted text so the user can see
   * the folder that will be used by default. Omit (or pass an empty string)
   * for a generic "(default)" placeholder.
   */
  defaultPath?: string;
  /** Disable the picker + clear buttons (e.g. while saving). */
  disabled?: boolean;
}

/**
 * Reusable folder-picker field rendered as a single input-style box: the
 * current path (or `defaultPath` placeholder) spans the full width, with a
 * trailing folder-icon button embedded at the right edge of the same box.
 * Clicking the icon opens the native OS folder dialog (desktop app only).
 * On the web build (no native bridge) the picker is disabled.
 */
export function FolderPickerField({
  value,
  onChange,
  label = "Local folder",
  defaultPath,
  disabled = false,
}: FolderPickerFieldProps) {
  const { hasDesktopBridge } = useAuraCapabilities();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = useCallback(async () => {
    if (disabled || picking || !hasDesktopBridge) return;
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
  }, [disabled, picking, hasDesktopBridge, onChange]);

  const handleClear = useCallback(() => {
    if (disabled) return;
    onChange("");
  }, [disabled, onChange]);

  const hasOverride = Boolean(value);
  const displayText = hasOverride
    ? value
    : defaultPath && defaultPath.length > 0
      ? defaultPath
      : "(default)";

  return (
    <div className={styles.fieldGroup}>
      {label ? (
        <Text size="sm" className={styles.label}>
          {label}
        </Text>
      ) : null}
      <div className={styles.field}>
        <Text
          variant="muted"
          size="sm"
          className={`${styles.pathText} ${!hasOverride ? styles.pathTextDefault : ""}`}
          title={displayText}
        >
          {displayText}
        </Text>
        {hasOverride ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            aria-label="Clear folder"
            className={styles.iconButton}
          >
            <X size={14} />
          </button>
        ) : null}
        {hasDesktopBridge ? (
          <button
            type="button"
            onClick={handlePick}
            disabled={disabled || picking}
            aria-label="Choose folder"
            className={styles.iconButton}
          >
            <FolderOpen size={14} />
          </button>
        ) : null}
      </div>
      {!hasDesktopBridge ? (
        <Text variant="muted" size="xs" className={styles.hint}>
          Folder pickers are only available in the Aura desktop app; this
          setting only applies when the project's agents run on a local
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
