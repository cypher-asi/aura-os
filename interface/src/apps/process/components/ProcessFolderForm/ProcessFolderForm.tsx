import { useEffect, useRef, useState } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import { processApi } from "../../../../api/process";
import { useProcessStore } from "../../stores/process-store";

interface ProcessFolderFormProps {
  onClose: () => void;
}

export function ProcessFolderForm({ onClose }: ProcessFolderFormProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addFolder = useProcessStore((s) => s.addFolder);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const folder = await processApi.createFolder({ name: name.trim() });
      addFolder(folder);
      onClose();
    } catch {
      setError("Failed to create folder.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="New Folder"
      size="sm"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={loading || !name.trim()}>
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
            placeholder="My Folder"
          />
        </div>
        {error && <div style={{ fontSize: 12, color: "var(--color-error)" }}>{error}</div>}
      </div>
    </Modal>
  );
}
