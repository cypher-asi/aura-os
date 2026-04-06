import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Button } from "@cypher-asi/zui";
import { processApi } from "../../../../api/process";
import { projectsApi } from "../../../../api/projects";
import { useProcessStore } from "../../stores/process-store";
import type { Project } from "../../../../types";

interface ProcessFormProps {
  onClose: () => void;
  folderId?: string | null;
  onCreated?: (processId: string) => void;
}

export function ProcessForm({ onClose, folderId, onCreated }: ProcessFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addProcess = useProcessStore((s) => s.addProcess);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
    projectsApi.listProjects().then((ps) => {
      setProjects(ps);
      if (ps.length > 0 && !projectId) setProjectId(ps[0].project_id);
    }).catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!name.trim() || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      const process = await processApi.createProcess({
        name: name.trim(),
        description: description.trim() || undefined,
        project_id: projectId,
        folder_id: folderId ?? undefined,
      });
      addProcess(process);
      onCreated?.(process.process_id);
      navigate(`/process/${process.process_id}`);
      onClose();
    } catch {
      setError("Failed to create process.");
    } finally {
      setLoading(false);
    }
  };

  const selectStyle: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--color-border)",
    background: "var(--color-bg-input)",
    color: "var(--color-text)",
    fontSize: 13,
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New Process"
      size="sm"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading || !name.trim() || !projectId}>
            {loading ? "Creating..." : "Create"}
          </Button>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-muted)" }}>Name</label>
          <input
            ref={inputRef}
            style={{
              padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
              background: "var(--color-bg-input)", color: "var(--color-text)", fontSize: 13,
            }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSubmit(); }}
            placeholder="My Process"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-muted)" }}>Description</label>
          <textarea
            style={{
              padding: "8px 10px", borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
              background: "var(--color-bg-input)", color: "var(--color-text)", fontSize: 13, resize: "vertical",
              minHeight: 60,
            }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-muted)" }}>Project</label>
          {projects.length > 0 ? (
            <select style={selectStyle} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>{p.name}</option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 12, color: "var(--color-text-faint)", padding: "8px 0" }}>
              Loading projects...
            </div>
          )}
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--color-error)" }}>{error}</div>}
      </div>
    </Modal>
  );
}
