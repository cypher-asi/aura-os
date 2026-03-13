import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { PageHeader, Panel, Input, Textarea, Label, Button, Spinner, Text } from "@cypher-asi/zui";

export function NewProjectView() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [reqPath, setReqPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Project name is required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const project = await api.createProject({
        name: name.trim(),
        description: description.trim(),
        linked_folder_path: folderPath.trim(),
        requirements_doc_path: reqPath.trim(),
      });
      navigate(`/projects/${project.project_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <PageHeader title="New Project" subtitle="Create a new project to start building" />
      <form onSubmit={handleSubmit} style={{ maxWidth: 560 }}>
        <Panel variant="solid" border="solid" borderRadius="md" style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <div>
            <Label size="sm" uppercase={false} style={{ display: "block", marginBottom: "var(--space-1)" }}>Project Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Awesome App" autoFocus />
          </div>
          <div>
            <Label size="sm" uppercase={false} style={{ display: "block", marginBottom: "var(--space-1)" }}>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the project..." />
          </div>
          <div>
            <Label size="sm" uppercase={false} style={{ display: "block", marginBottom: "var(--space-1)" }}>Linked Folder Path</Label>
            <Input value={folderPath} onChange={(e) => setFolderPath(e.target.value)} placeholder="/path/to/your/codebase" mono />
          </div>
          <div>
            <Label size="sm" uppercase={false} style={{ display: "block", marginBottom: "var(--space-1)" }}>Requirements Doc Path</Label>
            <Input value={reqPath} onChange={(e) => setReqPath(e.target.value)} placeholder="/path/to/requirements.md" mono />
          </div>
          {error && <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>{error}</Text>}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? <><Spinner size="sm" /> Creating...</> : "Create Project"}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => navigate("/")}>
              Cancel
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  );
}
