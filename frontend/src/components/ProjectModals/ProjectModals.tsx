import { Modal, Button, Input, Spinner, Text } from "@cypher-asi/zui";
import type { Project, AgentInstance } from "../../types";
import { useProjectSettingsData } from "./useProjectSettingsData";
import styles from "../ProjectList/ProjectList.module.css";

interface DeleteProjectModalProps {
  target: Project | null;
  loading: boolean;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteProjectModal({ target, loading, onClose, onDelete }: DeleteProjectModalProps) {
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Delete Project"
      size="sm"
      footer={
        <div className={styles.confirmFooter}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onDelete} disabled={loading} className={styles.dangerButton}>
            {loading ? "Deleting..." : "Delete"}
          </Button>
        </div>
      }
    >
      <div className={styles.confirmMessage}>
        Are you sure you want to delete &ldquo;{target?.name}&rdquo;? This action cannot be undone.
      </div>
    </Modal>
  );
}

interface DeleteAgentInstanceModalProps {
  target: AgentInstance | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onDelete: () => void;
}

export function DeleteAgentInstanceModal({ target, loading, error, onClose, onDelete }: DeleteAgentInstanceModalProps) {
  return (
    <Modal
      isOpen={!!target}
      onClose={onClose}
      title="Remove Agent"
      size="sm"
      footer={
        <div className={styles.confirmFooter}>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={onDelete} disabled={loading} className={styles.dangerButton}>
            {loading ? "Removing..." : "Remove"}
          </Button>
        </div>
      }
    >
      <div className={styles.confirmMessage}>
        Are you sure you want to remove &ldquo;{target?.name}&rdquo; and all its messages? This action cannot be undone.
      </div>
      {error && (
        <div className={styles.errorMessage} role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

interface ProjectSettingsModalProps {
  target: Project | null;
  onClose: () => void;
  onSaved: (project: Project) => void;
}

export function ProjectSettingsModal({ target, onClose, onSaved }: ProjectSettingsModalProps) {
  const {
    project, gitRepoUrl, setGitRepoUrl, gitBranch, setGitBranch,
    collaborators, collaboratorsLoading, loading, saving, error, handleSave,
  } = useProjectSettingsData(target, onSaved, onClose);

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
        <div style={{ padding: "var(--space-4)" }}>
          <Spinner size="md" />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
          <Text variant="muted" size="sm" style={{ marginBottom: "var(--space-1)" }}>
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
          {project?.orbit_owner && project?.orbit_repo && (
            <>
              <Text variant="muted" size="sm" style={{ marginTop: "var(--space-2)", marginBottom: "var(--space-1)" }}>
                Repo collaborators
              </Text>
              {collaboratorsLoading ? (
                <Spinner size="sm" />
              ) : collaborators && collaborators.length > 0 ? (
                <ul style={{ margin: 0, paddingLeft: "var(--space-4)", fontSize: "var(--font-size-sm)" }}>
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
            <Text variant="muted" size="sm" style={{ color: "var(--color-danger)" }}>
              {error}
            </Text>
          )}
        </div>
      )}
    </Modal>
  );
}
