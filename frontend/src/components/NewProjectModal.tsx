import { useState } from "react";
import { api } from "../api/client";
import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [reqPath, setReqPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");

  const reset = () => {
    setName("");
    setDescription("");
    setFolderPath("");
    setReqPath("");
    setLoading(false);
    setError("");
    setNameError("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError("Project name is required");
      return;
    }
    setNameError("");
    setLoading(true);
    setError("");
    try {
      const project = await api.createProject({
        name: name.trim(),
        description: description.trim(),
        linked_folder_path: folderPath.trim(),
        requirements_doc_path: reqPath.trim(),
      });
      reset();
      onCreated(project.project_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Project"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? <><Spinner size="sm" /> Creating...</> : "Create Project"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <Input
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(""); }}
          placeholder="Project name"
          validationMessage={nameError}
          autoFocus
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <Input
          value={folderPath}
          onChange={(e) => setFolderPath(e.target.value)}
          placeholder="Linked folder path"
          mono
        />
        <Input
          value={reqPath}
          onChange={(e) => setReqPath(e.target.value)}
          placeholder="Requirements doc path"
          mono
        />
        {error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
