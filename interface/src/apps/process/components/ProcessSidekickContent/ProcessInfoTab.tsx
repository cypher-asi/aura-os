import { useParams } from "react-router-dom";
import { Text } from "@cypher-asi/zui";
import { useProcessStore } from "../../stores/process-store";
import { EmptyState } from "../../../../components/EmptyState";
import previewStyles from "../../../../components/Preview/Preview.module.css";

const SUCCESS_COLOR = "var(--color-success, #4aeaa8)";
const SUCCESS_BACKGROUND = "color-mix(in srgb, var(--color-success, #4aeaa8) 15%, transparent)";

export function ProcessInfoTab() {
  const { processId } = useParams<{ processId: string }>();
  const processes = useProcessStore((s) => s.processes);
  const process = processes.find((p) => p.process_id === processId);

  if (!process) return <EmptyState>No process selected</EmptyState>;

  return (
    <div className={previewStyles.previewBody}>
      <div className={previewStyles.taskMeta}>
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Name</span>
          <Text size="sm" style={{ fontWeight: 600 }}>{process.name}</Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Status</span>
          <span>
            <span
              style={{
                display: "inline-block",
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 0,
                background: process.enabled ? SUCCESS_BACKGROUND : "rgba(107,114,128,0.15)",
                color: process.enabled ? SUCCESS_COLOR : "#6b7280",
                fontWeight: 600,
              }}
            >
              {process.enabled ? "Active" : "Paused"}
            </span>
          </span>
        </div>

        {process.description && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Description</span>
            <Text variant="secondary" size="sm">{process.description}</Text>
          </div>
        )}

        {process.schedule && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Schedule</span>
            <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
              {process.schedule}
            </Text>
          </div>
        )}

        {process.tags.length > 0 && (
          <div className={previewStyles.taskField}>
            <span className={previewStyles.fieldLabel}>Tags</span>
            <Text variant="secondary" size="sm">{process.tags.join(", ")}</Text>
          </div>
        )}

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Last Run</span>
          <Text variant="secondary" size="sm">
            {process.last_run_at ? new Date(process.last_run_at).toLocaleString() : "Never"}
          </Text>
        </div>

        <div className={previewStyles.taskField} style={{ borderTop: "1px solid var(--color-border)", paddingTop: 12, marginTop: 4 }}>
          <span className={previewStyles.fieldLabel}>Process ID</span>
          <Text variant="secondary" size="sm" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            {process.process_id}
          </Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Created</span>
          <Text variant="secondary" size="sm">{new Date(process.created_at).toLocaleString()}</Text>
        </div>

        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Updated</span>
          <Text variant="secondary" size="sm">{new Date(process.updated_at).toLocaleString()}</Text>
        </div>
      </div>
    </div>
  );
}
