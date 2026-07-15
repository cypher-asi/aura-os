import { useEffect, useState } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { Check, Pencil, X } from "lucide-react";
import { api } from "../../../api/client";
import { track } from "../../../lib/analytics";
import type { MemoryAccessOptions, MemoryFact, MemoryEvent, MemoryProcedure } from "../../../shared/types";
import previewStyles from "../../../components/Preview/Preview.module.css";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function FactPreview({
  fact,
  agentId,
  access,
}: {
  fact: MemoryFact;
  agentId: string;
  access?: MemoryAccessOptions;
}) {
  const [currentFact, setCurrentFact] = useState(fact);
  const [editing, setEditing] = useState(false);
  const [draftKey, setDraftKey] = useState(fact.key);
  const [draftValue, setDraftValue] = useState(
    typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrentFact(fact);
    setDraftKey(fact.key);
    setDraftValue(typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value, null, 2));
    setEditing(false);
    setError(null);
  }, [fact]);

  const valueDisplay = typeof currentFact.value === "string"
    ? currentFact.value
    : JSON.stringify(currentFact.value, null, 2);

  const saveCorrection = async () => {
    setSaving(true);
    setError(null);
    try {
      let value: MemoryFact["value"] = draftValue;
      if (typeof currentFact.value !== "string") {
        value = JSON.parse(draftValue) as MemoryFact["value"];
      }
      const updated = await api.memory.updateFact(agentId, currentFact.fact_id, {
        key: draftKey.trim(),
        value,
        confidence: 1,
        importance: currentFact.importance,
        source: "user_provided",
        continuity: {
          ...currentFact.continuity,
          status: "active",
          sensitivity: "normal",
        },
      }, access);
      setCurrentFact(updated);
      setEditing(false);
      track("memory_corrected", { kind: "fact" });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update memory");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={previewStyles.taskMeta}>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
        {editing ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              <X size={12} /> Cancel
            </Button>
            <Button size="sm" onClick={() => void saveCorrection()} disabled={saving || !draftKey.trim()}>
              <Check size={12} /> {saving ? "Saving" : "Save correction"}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <Pencil size={12} /> Correct
          </Button>
        )}
      </div>
      {error && <Text size="xs" style={{ color: "var(--color-danger)" }}>{error}</Text>}
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Key</span>
        {editing ? (
          <input
            value={draftKey}
            onChange={(event) => setDraftKey(event.currentTarget.value)}
            aria-label="Memory key"
            style={{ width: "100%", boxSizing: "border-box" }}
          />
        ) : <Text size="sm">{currentFact.key}</Text>}
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Value</span>
        {editing ? (
          <textarea
            value={draftValue}
            onChange={(event) => setDraftValue(event.currentTarget.value)}
            aria-label="Memory value"
            rows={5}
            style={{ width: "100%", resize: "vertical", boxSizing: "border-box", fontFamily: "var(--font-mono)" }}
          />
        ) : (
          <pre style={{ margin: 0, fontSize: 12, fontFamily: "var(--font-mono)", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--color-text-secondary)" }}>
            {valueDisplay}
          </pre>
        )}
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Confidence</span>
        <Text size="sm">{Math.round(currentFact.confidence * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Importance</span>
        <Text size="sm">{Math.round(currentFact.importance * 100)}%</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Source</span>
        <Text size="sm">{currentFact.source}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Continuity</span>
        <Text size="sm">
          {currentFact.continuity.scope} · {currentFact.continuity.status}
          {currentFact.continuity.pinned ? " · pinned" : ""}
        </Text>
      </div>
      {currentFact.continuity.provenance.session_id && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Source session</span>
          <Text size="sm" variant="secondary">
            {currentFact.continuity.provenance.session_id}
          </Text>
        </div>
      )}
      {currentFact.continuity.provenance.excerpt && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Evidence</span>
          <Text size="sm" variant="secondary" style={{ whiteSpace: "pre-wrap" }}>
            {currentFact.continuity.provenance.excerpt}
          </Text>
        </div>
      )}
      {currentFact.continuity.provenance.extractor_model && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Extractor</span>
          <Text size="sm" variant="secondary">
            {currentFact.continuity.provenance.extractor_model}
          </Text>
        </div>
      )}
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Access Count</span>
        <Text size="sm">{currentFact.access_count}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Last Accessed</span>
        <Text size="sm" variant="secondary">{formatDate(currentFact.last_accessed)}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Created</span>
        <Text size="sm" variant="secondary">{formatDate(currentFact.created_at)}</Text>
      </div>
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Updated</span>
        <Text size="sm" variant="secondary">{formatDate(currentFact.updated_at)}</Text>
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
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Continuity</span>
        <Text size="sm">{event.continuity.scope} · {event.continuity.status}</Text>
      </div>
      {event.continuity.provenance.session_id && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Source session</span>
          <Text size="sm" variant="secondary">{event.continuity.provenance.session_id}</Text>
        </div>
      )}
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
      {procedure.skill_name && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Skill</span>
          <Text size="sm">
            {procedure.skill_name}
            {procedure.skill_relevance != null && ` (${Math.round(procedure.skill_relevance * 100)}% relevance)`}
          </Text>
        </div>
      )}
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
      <div className={previewStyles.taskField}>
        <span className={previewStyles.fieldLabel}>Continuity</span>
        <Text size="sm">
          {procedure.continuity.scope} · {procedure.continuity.status}
          {procedure.continuity.pinned ? " · pinned" : ""}
        </Text>
      </div>
      {procedure.continuity.provenance.session_id && (
        <div className={previewStyles.taskField}>
          <span className={previewStyles.fieldLabel}>Source session</span>
          <Text size="sm" variant="secondary">{procedure.continuity.provenance.session_id}</Text>
        </div>
      )}
    </div>
  );
}
