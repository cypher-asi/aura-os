import { useEffect, useState } from "react";
import { Modal, Button, Text, Spinner } from "@cypher-asi/zui";
import { FolderOpen } from "lucide-react";
import { api } from "../../../api/client";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { EmptyState } from "../../../components/EmptyState";
import type { Agent, AgentInstance, Project } from "../../../shared/types";
import { getApiErrorMessage } from "../../../shared/utils/api-errors";
import styles from "./HireProjectPickerModal.module.css";

interface HireProjectPickerModalProps {
  isOpen: boolean;
  agent: Agent | null;
  onClose: () => void;
  onHired: (instance: AgentInstance, project: Project) => void;
}

/**
 * Picks a project to add a hireable marketplace agent to. Thin shell around
 * `api.createAgentInstance`; the list of projects comes from the already-
 * hydrated projects-list store, so this doesn't re-fetch when opened.
 */
export function HireProjectPickerModal({
  isOpen,
  agent,
  onClose,
  onHired,
}: HireProjectPickerModalProps) {
  const projects = useProjectsListStore((s) => s.projects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const refreshProjectAgents = useProjectsListStore((s) => s.refreshProjectAgents);
  const [hiringProjectId, setHiringProjectId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setError(null);
      setHiringProjectId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && projects.length === 0 && !loadingProjects) {
      void refreshProjects();
    }
  }, [isOpen, loadingProjects, projects.length, refreshProjects]);

  const handleHire = async (project: Project) => {
    if (!agent) return;
    setError(null);
    setHiringProjectId(project.project_id);
    try {
      const instance = await api.createAgentInstance(project.project_id, agent.agent_id);
      await refreshProjectAgents(project.project_id);
      onHired(instance, project);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setHiringProjectId(null);
    }
  };

  const isBusy = hiringProjectId !== null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isBusy) onClose();
      }}
      title={agent ? `Hire ${agent.name}` : "Hire agent"}
      size="sm"
      footer={
        <Button variant="ghost" onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
      }
    >
      {loadingProjects && projects.length === 0 ? (
        <div className={styles.loadingWrap}>
          <Spinner size="sm" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState>Create a project first, then you can add agents to it.</EmptyState>
      ) : (
        <div className={styles.projectList}>
          {projects.map((project) => {
            const isHiring = hiringProjectId === project.project_id;
            return (
              <button
                key={project.project_id}
                type="button"
                className={styles.projectRow}
                onClick={() => handleHire(project)}
                disabled={isBusy}
                aria-label={`Add to ${project.name}`}
              >
                <FolderOpen size={14} className={styles.projectIcon} />
                <span className={styles.projectName}>{project.name}</span>
                {isHiring ? <Spinner size="sm" /> : null}
              </button>
            );
          })}
        </div>
      )}
      {error ? (
        <Text size="xs" className={styles.error}>
          {error}
        </Text>
      ) : null}
    </Modal>
  );
}
