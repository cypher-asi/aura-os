import { useEffect, useRef, useState } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import type { Process, Project } from "../../../../shared/types";
import { processApi } from "../../../../shared/api/process";
import { projectsApi } from "../../../../shared/api/projects";
import { useProcessStore } from "../../stores/process-store";
import { SchedulePicker } from "../../../../components/SchedulePicker";

interface ProcessEditorModalProps {
  isOpen: boolean;
  process: Process;
  onClose: () => void;
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--color-border)",
  background: "var(--color-bg-input)",
  color: "var(--color-text)",
  fontSize: 13,
  fontFamily: "inherit",
  width: "100%",
  boxSizing: "border-box",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 400,
  color: "var(--color-text-muted, #9ca3af)",
};

export function ProcessEditorModal({ isOpen, process, onClose }: ProcessEditorModalProps) {
  const [name, setName] = useState(process.name);
  const [description, setDescription] = useState(process.description);
  const [schedule, setSchedule] = useState(process.schedule ?? "");
  const [tags, setTags] = useState(process.tags.join(", "));
  const [projectId, setProjectId] = useState(process.project_id ?? "");
  const [projects, setProjects] = useState<Project[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateProcess = useProcessStore((s) => s.updateProcess);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(process.name);
      setDescription(process.description);
      setSchedule(process.schedule ?? "");
      setTags(process.tags.join(", "));
      setProjectId(process.project_id ?? "");
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
      projectsApi.listProjects().then(setProjects).catch(() => {});
    }
  }, [isOpen, process]);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await processApi.updateProcess(process.process_id, {
        name: name.trim(),
        description: description.trim(),
        project_id: projectId || null,
        schedule: schedule.trim() || undefined,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      updateProcess(updated);
      onClose();
    } catch {
      setError("Failed to update process.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Process"
      size="sm"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Name</label>
          <input
            ref={inputRef}
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSave(); }}
            placeholder="Process name"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Description</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        {projects.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={labelStyle}>
              Project <span style={{ fontWeight: 400, color: "var(--color-text-faint)" }}>(optional)</span>
            </label>
            <select style={inputStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">None</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Schedule</label>
          <SchedulePicker value={schedule} onChange={setSchedule} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Tags</label>
          <input
            style={inputStyle}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Comma-separated tags"
          />
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--color-error)" }}>{error}</div>}
      </div>
    </Modal>
  );
}
