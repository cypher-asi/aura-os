import { useState, useEffect, useCallback } from "react";
import { Modal, Button, Input, Spinner, Text } from "@cypher-asi/zui";
import { api, type OrbitCollaborator } from "../../api/client";
import type { Project } from "../../types";
import { FolderPickerField } from "../FolderPickerField";
import styles from "./ProjectSettingsModal.module.css";

interface ProjectSettingsModalProps {
  target: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}

export function ProjectSettingsModal({ target, onClose, onSaved }: ProjectSettingsModalProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  const [gitBranch, setGitBranch] = useState("main");
  const [localWorkspacePath, setLocalWorkspacePath] = useState("");
  const [initialLocalWorkspacePath, setInitialLocalWorkspacePath] = useState("");
  const [collaborators, setCollaborators] = useState<OrbitCollaborator[] | null>(null);
  const [collaboratorsLoading, setCollaboratorsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) {
      setProject(null);
      setCollaborators(null);
      return;
    }
    setLoading(true);
    setError("");
    api
      .getProject(target.project_id)
      .then((p) => {
        setProject(p);
        setGitRepoUrl(p.git_repo_url ?? "");
        setGitBranch(p.git_branch ?? "main");
        const initialPath = p.local_workspace_path ?? "";
        setLocalWorkspacePath(initialPath);
        setInitialLocalWorkspacePath(initialPath);
      })
      .catch(() => setError("Failed to load project"))
      .finally(() => setLoading(false));
  }, [target, target?.project_id]);

  useEffect(() => {
    if (!project?.orbit_owner || !project?.orbit_repo) {
      setCollaborators(null);
      return;
    }
    setCollaboratorsLoading(true);
    api
      .listProjectOrbitCollaborators(project.project_id)
      .then(setCollaborators)
      .catch(() => setCollaborators([]))
      .finally(() => setCollaboratorsLoading(false));
  }, [project?.project_id, project?.orbit_owner, project?.orbit_repo]);

  const handleSave = useCallback(async () => {
    if (!project) return;
    setSaving(true);
    setError("");
    try {
      const trimmedLocalPath = localWorkspacePath.trim();
      const localPathChanged =
        trimmedLocalPath !== (initialLocalWorkspacePath ?? "").trim();
      const updated = await api.updateProject(project.project_id, {
        git_repo_url: gitRepoUrl.trim() || undefined,
        git_branch: gitBranch.trim() || undefined,
        ...(localPathChanged
          ? { local_workspace_path: trimmedLocalPath ? trimmedLocalPath : null }
          : {}),
      });
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }, [project, gitRepoUrl, gitBranch, localWorkspacePath, initialLocalWorkspacePath, onSaved, onClose]);

  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Project settings"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? <><Spinner size="sm" /> Saving...</> : "Save"}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className={styles.loadingPad}>
          <Spinner size="md" />
        </div>
      ) : (
        <div className={styles.formColumn}>
          <Text variant="muted" size="sm" className={styles.sectionLabel}>
            Git / Orbit
          </Text>
          <Input
            value={gitRepoUrl}
            onChange={(e) => setGitRepoUrl(e.target.value)}
            placeholder="Git remote URL"
          />
          <Input
            value={gitBranch}
            onChange={(e) => setGitBranch(e.target.value)}
            placeholder="Branch (e.g. main)"
          />
          <Text variant="muted" size="sm" className={styles.sectionLabelTop}>
            Local workspace
          </Text>
          <FolderPickerField
            label="Local workspace folder (optional)"
            value={localWorkspacePath}
            onChange={setLocalWorkspacePath}
            disabled={saving}
            defaultHint="Only applies to agents running on this machine. Leave blank to use the default Aura-managed workspace."
          />
          {project?.orbit_owner && project?.orbit_repo && (
            <>
              <Text variant="muted" size="sm" className={styles.sectionLabelTop}>
                Repo collaborators
              </Text>
              {collaboratorsLoading ? (
                <Spinner size="sm" />
              ) : collaborators && collaborators.length > 0 ? (
                <ul className={styles.collaboratorList}>
                  {collaborators.map((c, i) => (
                    <li key={c.user_id ?? c.username ?? i}>
                      {c.display_name ?? c.username ?? c.user_id ?? "—"} ({c.role})
                      {c.role === "owner" ? " — can add people" : ""}
                    </li>
                  ))}
                </ul>
              ) : collaborators?.length === 0 ? (
                <Text variant="muted" size="sm">No collaborators returned.</Text>
              ) : null}
              <Text variant="muted" size="xs">Repo owner and users with owner role can add people.</Text>
            </>
          )}
          {error && (
            <Text variant="muted" size="sm" className={styles.dangerText}>
              {error}
            </Text>
          )}
        </div>
      )}
    </Modal>
  );
}
