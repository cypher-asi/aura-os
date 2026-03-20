import { Button, Text } from "@cypher-asi/zui";
import type { WorkspaceMode, WorkspaceModeOption } from "../hooks/use-new-project-form";

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

export function ImportFilesSection({
  importFolderInputRef,
  importFilesInputRef,
  onImportSelection,
  importSummary,
  loading,
}: {
  importFolderInputRef: React.RefObject<HTMLInputElement | null>;
  importFilesInputRef: React.RefObject<HTMLInputElement | null>;
  onImportSelection: (files: FileList | null) => void;
  importSummary: { count: number; sizeLabel: string; samplePaths: string[] };
  loading: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      <input
        ref={importFolderInputRef}
        type="file"
        multiple
        onChange={(event) => onImportSelection(event.target.files)}
        style={{ display: "none" }}
      />
      <input
        ref={importFilesInputRef}
        type="file"
        multiple
        onChange={(event) => onImportSelection(event.target.files)}
        style={{ display: "none" }}
      />
      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <Button variant="secondary" onClick={() => importFolderInputRef.current?.click()} disabled={loading}>
          Open folder
        </Button>
        <Button variant="ghost" onClick={() => importFilesInputRef.current?.click()} disabled={loading}>
          Choose files
        </Button>
      </div>
      {importSummary.count === 0 && (
        <Text size="sm" style={{ color: "var(--color-warning)" }}>
          Choose a folder or files to enable project creation.
        </Text>
      )}
      <Text variant="muted" size="sm">
        Aura prepares a workspace from the selected local files on the connected host so you can keep working from the browser.
      </Text>
      {importSummary.count > 0 && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-md)",
            padding: "var(--space-3)",
            background: "var(--color-bg-elevated)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          <Text size="sm" style={{ fontWeight: 600 }}>
            {importSummary.count} file{importSummary.count === 1 ? "" : "s"} selected
          </Text>
          <Text variant="muted" size="sm">
            {importSummary.sizeLabel}
          </Text>
          {importSummary.samplePaths.map((path) => (
            <Text key={path} variant="muted" size="xs" style={{ wordBreak: "break-all" }}>
              {path}
            </Text>
          ))}
        </div>
      )}
    </div>
  );
}
