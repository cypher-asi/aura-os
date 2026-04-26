import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Text } from "@cypher-asi/zui";
import { Link2, Plus, Sparkles } from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { selectOverlayDrawerOpen, useMobileDrawerStore } from "../../../stores/mobile-drawer-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { formatChatTime } from "../../../shared/utils/format";
import {
  projectAgentAttachRoute,
  projectAgentChatRoute,
  projectAgentCreateRoute,
} from "../../../utils/mobileNavigation";
import { getLastAgent, setLastAgent, setLastProject } from "../../../utils/storage";
import type { AgentInstance } from "../../../shared/types";
import styles from "./ProjectAgentsScreen.module.css";

function formatAgentStatus(status: string | undefined): string {
  if (!status) return "Ready";
  if (status === "in_progress" || status === "working") return "Working";
  return status.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function getAgentDisplayName(agent: AgentInstance): string {
  const trimmedName = agent.name?.trim();
  if (trimmedName) return trimmedName;

  const trimmedRole = agent.role?.trim();
  if (trimmedRole) return trimmedRole;

  return "Unnamed agent";
}

export function MobileProjectAgentsScreen() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const closePreview = useSidekickStore((s) => s.closePreview);
  const overlayDrawerOpen = useMobileDrawerStore(selectOverlayDrawerOpen);
  const agentsByProject = useProjectsListStore((s) => s.agentsByProject);
  const loadingAgentsByProject = useProjectsListStore((s) => s.loadingAgentsByProject);
  const refreshProjectAgents = useProjectsListStore((s) => s.refreshProjectAgents);
  const project = useProjectsListStore((s) => (
    projectId ? s.projects.find((candidate) => candidate.project_id === projectId) ?? null : null
  ));
  const [actionSheetOpen, setActionSheetOpen] = useState(false);

  const agents = useMemo<AgentInstance[]>(
    () => (projectId ? agentsByProject[projectId] ?? [] : []),
    [agentsByProject, projectId],
  );
  const loading = projectId ? loadingAgentsByProject[projectId] === true : false;
  const rememberedAgentId = projectId ? getLastAgent(projectId) : null;

  useEffect(() => {
    if (!projectId || projectId in agentsByProject) return;
    void refreshProjectAgents(projectId);
  }, [agentsByProject, projectId, refreshProjectAgents]);

  const openAgent = useCallback((agentInstanceId: string) => {
    if (!projectId) return;
    closePreview();
    setLastProject(projectId);
    setLastAgent(projectId, agentInstanceId);
    navigate(projectAgentChatRoute(projectId, agentInstanceId));
  }, [closePreview, navigate, projectId]);

  const openCreate = useCallback(() => {
    if (!projectId) return;
    setActionSheetOpen(false);
    navigate(projectAgentCreateRoute(projectId));
  }, [navigate, projectId]);

  const openAttach = useCallback(() => {
    if (!projectId) return;
    setActionSheetOpen(false);
    navigate(projectAgentAttachRoute(projectId));
  }, [navigate, projectId]);

  if (!projectId) {
    return null;
  }

  const addAgentButton = agents.length > 0 && !overlayDrawerOpen && !actionSheetOpen ? (
    <button
      type="button"
      className={styles.fab}
      aria-label="Add project agent"
      onClick={() => setActionSheetOpen(true)}
    >
      <Plus size={20} strokeWidth={2.7} />
      <span className={styles.fabLabel}>Add</span>
    </button>
  ) : null;

  return (
    <>
      <div className={styles.root}>
        {agents.length > 0 ? (
          <header className={styles.summaryBar} aria-label="Project agents summary">
            <span>{agents.length === 1 ? "1 attached" : `${agents.length} attached`}</span>
          </header>
        ) : null}

        {loading && agents.length === 0 ? (
          <div className={styles.emptyState}>
            <Text size="sm" weight="medium">Loading project agents…</Text>
          </div>
        ) : agents.length === 0 ? (
          <div className={styles.emptyState}>
            <Text size="sm" weight="medium">No agents attached yet</Text>
            <Text size="sm" variant="muted">
              Add a remote agent to start chatting, running tasks, and browsing project files.
            </Text>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setActionSheetOpen(true)}>
              Add Agent
            </Button>
          </div>
        ) : (
          <section className={styles.agentList} aria-label={`${project?.name ?? "Project"} agents`}>
            {agents.map((agent) => {
              const isRemembered = agent.agent_instance_id === rememberedAgentId;
              const displayName = getAgentDisplayName(agent);
              return (
                <button
                  key={agent.agent_instance_id}
                  type="button"
                  className={`${styles.agentRow} ${isRemembered ? styles.agentRowRemembered : ""}`}
                  onClick={() => openAgent(agent.agent_instance_id)}
                  aria-label={`Open chat with ${displayName}`}
                >
                  <Avatar
                    avatarUrl={agent.icon ?? undefined}
                    name={displayName}
                    type="agent"
                    size={40}
                    status={agent.status}
                    className={styles.avatar}
                  />
                  <span className={styles.agentBody}>
                    <span className={styles.agentTopLine}>
                      <span className={styles.agentName}>{displayName}</span>
                      <span className={styles.agentTime}>{formatChatTime(agent.updated_at)}</span>
                    </span>
                    <span className={styles.agentMetaLine}>
                      <span>{agent.role?.trim() || "Remote AURA agent"}</span>
                      <span className={styles.statusDotText}>{formatAgentStatus(agent.status)}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </section>
        )}
        {addAgentButton}
      </div>

      {actionSheetOpen ? (
        <>
          <button
            type="button"
            className={styles.sheetBackdrop}
            aria-label="Close add agent options"
            onClick={() => setActionSheetOpen(false)}
          />
          <div className={styles.actionSheet} role="dialog" aria-modal="true" aria-label="Add project agent">
            <div className={styles.actionSheetHeader}>
              <div>
                <div className={styles.actionSheetTitle}>Add project agent</div>
                <div className={styles.actionSheetSubtitle}>Create a new remote agent or attach one your team already uses.</div>
              </div>
              <button
                type="button"
                className={styles.cancelButton}
                aria-label="Cancel add agent"
                onClick={() => setActionSheetOpen(false)}
              >
                Cancel
              </button>
            </div>
            <div className={styles.actionChoices}>
              <button type="button" className={styles.actionChoice} onClick={openCreate}>
                <span className={styles.actionIcon}><Sparkles size={18} /></span>
                <span className={styles.actionCopy}>
                  <span className={styles.actionTitle}>Create Remote Agent</span>
                  <span className={styles.actionMeta}>Start a fresh AURA-managed agent for this project.</span>
                </span>
              </button>
              <button type="button" className={styles.actionChoice} onClick={openAttach}>
                <span className={styles.actionIcon}><Link2 size={18} /></span>
                <span className={styles.actionCopy}>
                  <span className={styles.actionTitle}>Attach Existing Agent</span>
                  <span className={styles.actionMeta}>Reuse an available shared agent from this organization.</span>
                </span>
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
