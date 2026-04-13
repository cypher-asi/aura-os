import { useRef, useState } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { ArrowLeft, GitBranch } from "lucide-react";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { StatusBadge } from "../StatusBadge";
import { api } from "../../api/client";
import type { Project } from "../../types";
import styles from "../Sidekick/Sidekick.module.css";

interface InfoPanelProps {
  project: Project;
  workspacePath?: string;
  remoteAgentId?: string;
  onClose: () => void;
}

export function InfoPanel({
  project,
  workspacePath,
  remoteAgentId,
  onClose,
}: InfoPanelProps) {
  const workspaceLabel = workspacePath ?? "\u2014";
  const [openingWorkspace, setOpeningWorkspace] = useState(false);
  const [openWorkspaceError, setOpenWorkspaceError] = useState<string | null>(
    null,
  );
  const canOpenWorkspace = Boolean(workspacePath) && !remoteAgentId;
  const infoAreaRef = useRef<HTMLDivElement>(null);

  const handleOpenWorkspace = async () => {
    if (!workspacePath || openingWorkspace || remoteAgentId) return;
    setOpenWorkspaceError(null);
    setOpeningWorkspace(true);
    try {
      const result = await api.openPath(workspacePath);
      if (!result.ok) {
        setOpenWorkspaceError(
          result.error ?? "Could not open workspace folder.",
        );
      }
    } catch {
      setOpenWorkspaceError("Could not open workspace folder.");
    } finally {
      setOpeningWorkspace(false);
    }
  };

  return (
    <div className={styles.infoAreaShell}>
      <div ref={infoAreaRef} className={styles.infoArea}>
        <div className={styles.infoHeader}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<ArrowLeft size={14} />}
            onClick={onClose}
          />
          <Text size="sm" className={styles.infoBoldTitle}>
            Project Info
          </Text>
        </div>
        <div className={styles.infoGrid}>
          <Text variant="muted" size="sm" as="span">
            Status
          </Text>
          <span>
            <StatusBadge status={project.current_status} />
          </span>
          <Text variant="muted" size="sm" as="span">
            Agent workspace
          </Text>
          <span className={styles.infoWorkspaceCell}>
            {canOpenWorkspace ? (
              <button
                type="button"
                className={styles.infoWorkspaceLink}
                onClick={handleOpenWorkspace}
                disabled={openingWorkspace}
                title={workspacePath}
              >
                {workspaceLabel}
              </button>
            ) : (
              <Text size="sm" as="span">
                {workspaceLabel}
              </Text>
            )}
            {remoteAgentId ? (
              <Text size="xs" variant="muted" as="span">
                Resolved from the attached remote agent
              </Text>
            ) : null}
            {openWorkspaceError ? (
              <Text size="xs" variant="muted" as="span">
                {openWorkspaceError}
              </Text>
            ) : null}
          </span>
          <Text variant="muted" size="sm" as="span">
            Created
          </Text>
          <Text size="sm" as="span">
            {new Date(project.created_at).toLocaleString()}
          </Text>

          <Text variant="muted" size="sm" as="span">
            Orbit
          </Text>
          <span className={styles.infoWorkspaceCell}>
            {project.orbit_owner && project.orbit_repo ? (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <GitBranch size={12} />
                <Text size="sm" as="span">
                  {project.orbit_owner}/{project.orbit_repo}
                </Text>
              </span>
            ) : (
              <Text size="sm" variant="muted" as="span">
                Not linked
              </Text>
            )}
            {project.git_branch && (
              <Text size="xs" variant="muted" as="span">
                branch: {project.git_branch}
              </Text>
            )}
          </span>

          {project.git_repo_url && (
            <>
              <Text variant="muted" size="sm" as="span">
                Git URL
              </Text>
              <Text size="sm" as="span" style={{ wordBreak: "break-all" }}>
                {project.git_repo_url}
              </Text>
            </>
          )}
        </div>
      </div>
      <OverlayScrollbar scrollRef={infoAreaRef} />
    </div>
  );
}
