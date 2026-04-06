import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Modal, Button } from "@cypher-asi/zui";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";

interface ProcessFormProps {
  onClose: () => void;
  projectId?: string | null;
  onCreated?: (processId: string) => void;
}

export function ProcessForm({ onClose, projectId: initialProjectId, onCreated }: ProcessFormProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const projects = useProjectsListStore((s) => s.projects);
  const [selectedProjectId, setSelectedProjectId] = useState(initialProjectId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addProcess = useProcessStore((s) => s.addProcess);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!selectedProjectId && projects.length > 0) {
      setSelectedProjectId(initialProjectId ?? projects[0].project_id);
    }
  }, [projects, initialProjectId, selectedProjectId]);

  const handleSubmit = async () => {
    if (!name.trim() || !selectedProjectId) return;
    setLoading(true);
    setError(null);
    try {
      const process = await processApi.createProcess({
        name: name.trim(),
        description: description.trim() || undefined,
        project_id: selectedProjectId,
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
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading || !name.trim() || !selectedProjectId}>
            {loading ? "Creating..." : "Create"}
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
            onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) handleSubmit(); }}
            placeholder="My Process"
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={labelStyle}>Project</label>
          {projects.length > 0 ? (
            <select style={inputStyle} value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
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
