import { Text } from "@cypher-asi/zui";
import type { WorkspaceMode, WorkspaceModeOption } from "../../hooks/use-new-project-form";

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
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <Text size="sm" style={{ fontWeight: 600 }}>
        {showPicker ? "Workspace source" : selected.label}
      </Text>
      {showPicker ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              style={{
                textAlign: "left",
                borderRadius: "var(--radius-md)",
                border: option.id === workspaceMode ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                background: option.id === workspaceMode ? "rgba(255,255,255,0.06)" : "var(--color-bg-elevated)",
                color: "inherit",
                padding: "var(--space-3)",
                cursor: "pointer",
              }}
            >
              <div style={{ fontSize: "var(--font-size-sm)", fontWeight: 600 }}>{option.label}</div>
              <div style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-secondary)" }}>{option.description}</div>
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
