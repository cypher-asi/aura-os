import { Text } from "@cypher-asi/zui";
import type { WorkspaceMode, WorkspaceModeOption } from "../../hooks/use-new-project-form";
import styles from "./WorkspaceModeSection.module.css";

export function WorkspaceModeSection({
  workspaceMode,
  onSelect,
  options,
  showPicker,
}: {
  workspaceMode: WorkspaceMode;
  onSelect: (mode: WorkspaceMode) => void;
  options: WorkspaceModeOption[];
  showPicker: boolean;
}) {
  const selected = options.find((o) => o.id === workspaceMode) ?? options[0];

  return (
    <div className={styles.container}>
      <Text size="sm" className={styles.labelBold}>
        {showPicker ? "Workspace source" : selected.label}
      </Text>
      {showPicker ? (
        <div className={styles.container}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={styles.optionButton}
              style={{
                border: option.id === workspaceMode ? "1px solid #fff" : "1px solid var(--color-border)",
                background: option.id === workspaceMode ? "rgba(255,255,255,0.06)" : "var(--color-bg-elevated)",
              }}
            >
              <div className={styles.optionLabel}>{option.label}</div>
              <div className={styles.optionDescription}>{option.description}</div>
            </button>
          ))}
        </div>
      ) : (
        <Text variant="muted" size="sm">
          {selected.description}
        </Text>
      )}
    </div>
  );
}
