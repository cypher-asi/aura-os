import { Text } from "@cypher-asi/zui";
import type { MemoryFact, MemoryEvent, MemoryProcedure } from "../../../types";
import previewStyles from "../../../components/Preview/Preview.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function FactPreview({ fact }: { fact: MemoryFact }) {
  const valueDisplay = typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2);
  return (
    <div className={previewStyles.taskMeta}>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Key</span>
        <Text size="sm">{fact.key}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Value</span>
        <pre style={{ margin: 0, fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-secondary)" }}>
          {valueDisplay}
        </pre>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Confidence</span>
        <Text size="sm">{Math.round(fact.confidence * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Importance</span>
        <Text size="sm">{Math.round(fact.importance * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Source</span>
        <Text size="sm">{fact.source}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Access Count</span>
        <Text size="sm">{fact.access_count}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Last Accessed</span>
        <Text size="sm" variant="secondary">{formatDate(fact.last_accessed)}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Created</span>
        <Text size="sm" variant="secondary">{formatDate(fact.created_at)}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Updated</span>
        <Text size="sm" variant="secondary">{formatDate(fact.updated_at)}</Text>
      </div>
    </div>
  );
}

export function EventPreview({ event }: { event: MemoryEvent }) {
  const metadataDisplay = typeof event.metadata === "object" && event.metadata !== null
    ? JSON.stringify(event.metadata, null, 2)
    : String(event.metadata ?? "");
  return (
    <div className={previewStyles.taskMeta}>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Event Type</span>
        <Text size="sm">{event.event_type}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Summary</span>
        <Text size="sm" variant="secondary" style={{ whiteSpace: "pre-wrap" }}>{event.summary}</Text>
      </div>
      {metadataDisplay && metadataDisplay !== "null" && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Metadata</span>
          <pre style={{ margin: 0, fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-secondary)" }}>
            {metadataDisplay}
          </pre>
        </div>
      )}
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Importance</span>
        <Text size="sm">{Math.round(event.importance * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Timestamp</span>
        <Text size="sm" variant="secondary">{formatDate(event.timestamp)}</Text>
      </div>
    </div>
  );
}

export function ProcedurePreview({ procedure }: { procedure: MemoryProcedure }) {
  return (
    <div className={previewStyles.taskMeta}>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Name</span>
        <Text size="sm">{procedure.name}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Trigger</span>
        <Text size="sm" variant="secondary">{procedure.trigger}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Steps</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {procedure.steps.map((step, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{ color: "var(--color-text-muted)", fontWeight: 600, minWidth: 16, textAlign: "right" }}>{i + 1}.</span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-secondary)" }}>{step}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Success Rate</span>
        <Text size="sm">{Math.round(procedure.success_rate * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Execution Count</span>
        <Text size="sm">{procedure.execution_count}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Last Used</span>
        <Text size="sm" variant="secondary">{formatDate(procedure.last_used)}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Created</span>
        <Text size="sm" variant="secondary">{formatDate(procedure.created_at)}</Text>
      </div>
    </div>
  );
}

export const MemoryPreview = { FactPreview, EventPreview, ProcedurePreview };
