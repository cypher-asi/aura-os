import { useEffect } from "react";
import { Modal, Button } from "@cypher-asi/zui";
import { Trash2 } from "lucide-react";
import type { Project } from "../../types";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useProjectListActions } from "../../hooks/use-project-list-actions";
import styles from "./DeletedProjectsModal.module.css";

interface DeletedProjectsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DeletedProjectsModal({ isOpen, onClose }: DeletedProjectsModalProps) {
  const deletedProjects = useProjectsListStore((s) => s.deletedProjects);
  const loading = useProjectsListStore((s) => s.loadingDeletedProjects);
  const error = useProjectsListStore((s) => s.deletedProjectsError);
  const refresh = useProjectsListStore((s) => s.refreshDeletedProjects);
  const { handleRestore, restoreLoadingIds, restoreError } =
    useProjectListActions();

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const onRestore = async (project: Project) => {
    await handleRestore(project);
    await refresh();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Deleted Projects"
      size="md"
      footer={
        <div className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className={styles.body}>
        {loading && <div className={styles.empty}>Loading…</div>}
        {!loading && error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}
        {!loading && !error && deletedProjects.length === 0 && (
          <div className={styles.empty}>
            <Trash2 size={32} />
            <p>No deleted projects yet.</p>
          </div>
        )}
        {!loading && deletedProjects.length > 0 && (
          <ul className={styles.list}>
            {deletedProjects.map((project) => {
              const isRestoring = restoreLoadingIds.includes(project.project_id);
              return (
                <li key={project.project_id} className={styles.row}>
                  <div className={styles.meta}>
                    <div className={styles.name}>{project.name}</div>
                    {project.description && (
                      <div className={styles.description}>{project.description}</div>
                    )}
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void onRestore(project)}
                    disabled={isRestoring}
                  >
                    {isRestoring ? "Restoring…" : "Restore"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {restoreError && (
          <div className={styles.error} role="alert">
            {restoreError}
          </div>
        )}
      </div>
    </Modal>
  );
}
