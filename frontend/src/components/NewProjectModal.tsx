import { useState, useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useOrg } from "../context/OrgContext";
import { Modal, Input, Button, Spinner, Text } from "@cypher-asi/zui";
import { PathInput } from "./PathInput";
import type { GitHubRepo } from "../types";

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (project: import("../types").Project) => void;
}

export function NewProjectModal({ isOpen, onClose, onCreated }: NewProjectModalProps) {
  const { activeOrg, isLoading: orgLoading } = useOrg();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !activeOrg) return;
    api.orgs.listGithubRepos(activeOrg.org_id).then(setRepos).catch(() => setRepos([]));
  }, [isOpen, activeOrg]);

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => nameInputRef.current?.focus());
    }
  }, [isOpen]);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setFolderPath("");
    setSelectedRepo("");
    setLoading(false);
    setError("");
    setNameError("");
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setNameError("Project name is required");
      return;
    }
    setNameError("");
    setLoading(true);
    setError("");
    try {
      if (!activeOrg) return;
      const repoObj = repos.find((r) => r.full_name === selectedRepo);
      const project = await api.createProject({
        org_id: activeOrg.org_id,
        name: name.trim(),
        description: description.trim(),
        linked_folder_path: folderPath.trim(),
        github_integration_id: repoObj?.integration_id,
        github_repo_full_name: repoObj?.full_name,
      });
      reset();
      onCreated(project);
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
          <Button variant="primary" onClick={handleSubmit} disabled={loading || orgLoading || !activeOrg}>
            {loading ? <><Spinner size="sm" /> Creating...</> : "Create Project"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <Input
          ref={nameInputRef}
          value={name}
          onChange={(e) => { setName(e.target.value); setNameError(""); }}
          placeholder="Project name"
          validationMessage={nameError}
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
        />
        <PathInput
          value={folderPath}
          onChange={setFolderPath}
          placeholder="Linked folder path"
          mode="folder"
        />
        {repos.length > 0 && (
          <select
            value={selectedRepo}
            onChange={(e) => setSelectedRepo(e.target.value)}
            style={{
              padding: "var(--space-2)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--color-bg-elevated)",
              color: "var(--color-text)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            <option value="">No GitHub repository</option>
            {repos.map((r) => (
              <option key={r.github_repo_id} value={r.full_name}>
                {r.full_name}{r.private ? " (private)" : ""}
              </option>
            ))}
          </select>
        )}
        {!orgLoading && !activeOrg && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            No team found. Log out and back in to create a default team.
          </Text>
        )}
        {error && (
          <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </Text>
        )}
      </div>
    </Modal>
  );
}
