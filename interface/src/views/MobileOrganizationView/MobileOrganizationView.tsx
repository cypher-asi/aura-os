import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import {
  Building2,
  Check,
  ChevronRight,
  FolderKanban,
  Plus,
  Settings,
  Sparkles,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useOrgStore } from "../../stores/org-store";
import { getRecentProjects, useProjectsListStore } from "../../stores/projects-list-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import type { Org } from "../../types";
import {
  projectAgentChatRoute,
  projectAgentCreateRoute,
  projectAgentRoute,
  projectTasksRoute,
} from "../../utils/mobileNavigation";
import { getLastAgent, getLastAgentEntry, getLastProject } from "../../utils/storage";
import styles from "./MobileOrganizationView.module.css";

function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function MobileOrganizationView() {
  const navigate = useNavigate();
  const orgs = useOrgStore((s) => s.orgs);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const switchOrg = useOrgStore((s) => s.switchOrg);
  const createOrg = useOrgStore((s) => s.createOrg);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openSettings = useUIModalStore((s) => s.openSettings);
  const {
    projects,
    agentsByProject,
    loadingProjects,
    refreshProjects,
    refreshProjectAgents,
    openNewProjectModal,
  } = useProjectsListStore(
    useShallow((s) => ({
      projects: s.projects,
      agentsByProject: s.agentsByProject,
      loadingProjects: s.loadingProjects,
      refreshProjects: s.refreshProjects,
      refreshProjectAgents: s.refreshProjectAgents,
      openNewProjectModal: s.openNewProjectModal,
    })),
  );
  const { inputRef, initialFocusRef, autoFocus } = useModalInitialFocus<HTMLInputElement>();
  const [switchingOrgId, setSwitchingOrgId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const activeOrgProjects = useMemo(
    () => (activeOrg ? projects.filter((project) => project.org_id === activeOrg.org_id) : []),
    [activeOrg, projects],
  );
  const canCreateProject = activeOrg !== null || projects.length > 0;
  const recentProjects = useMemo(
    () => getRecentProjects(activeOrgProjects).slice(0, 3),
    [activeOrgProjects],
  );
  const lastProjectId = getLastProject();
  const lastAgentEntry = getLastAgentEntry();
  const resumeProject = useMemo(() => {
    const byLastProject = lastProjectId
      ? activeOrgProjects.find((project) => project.project_id === lastProjectId) ?? null
      : null;
    if (byLastProject) {
      return byLastProject;
    }

    const byLastAgent = lastAgentEntry
      ? activeOrgProjects.find((project) => project.project_id === lastAgentEntry.projectId) ?? null
      : null;
    return byLastAgent ?? recentProjects[0] ?? null;
  }, [activeOrgProjects, lastAgentEntry, lastProjectId, recentProjects]);
  const resumeProjectAgents = resumeProject ? agentsByProject[resumeProject.project_id] ?? [] : [];
  const resumeAgent = useMemo(() => {
    if (!resumeProject) {
      return null;
    }

    const rememberedAgentId = getLastAgent(resumeProject.project_id);
    return resumeProjectAgents.find((agent) => agent.agent_instance_id === rememberedAgentId)
      ?? resumeProjectAgents[0]
      ?? null;
  }, [resumeProject, resumeProjectAgents]);
  const handleSwitch = (org: Org) => {
    setSwitchingOrgId(org.org_id);
    switchOrg(org);
    startTransition(() => {
      navigate("/projects", { replace: true });
    });
  };

  useEffect(() => {
    if (!activeOrg || loadingProjects || activeOrgProjects.length > 0) {
      return;
    }
    void refreshProjects();
  }, [activeOrg, activeOrgProjects.length, loadingProjects, refreshProjects]);

  useEffect(() => {
    for (const project of recentProjects) {
      if (!(project.project_id in agentsByProject)) {
        void refreshProjectAgents(project.project_id);
      }
    }
  }, [agentsByProject, recentProjects, refreshProjectAgents]);

  const openProjectWorkspace = (projectId: string) => {
    const rememberedAgentId = getLastAgent(projectId);
    navigate(
      rememberedAgentId
        ? projectAgentChatRoute(projectId, rememberedAgentId)
        : projectAgentRoute(projectId),
    );
  };

  const openCreateProject = () => {
    openNewProjectModal();
    navigate("/projects");
  };

  async function handleCreateOrg() {
    const trimmed = teamName.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createOrg(trimmed);
      switchOrg(created.org_id);
      setCreateOpen(false);
      setTeamName("");
      navigate("/projects", { replace: true });
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create a team right now.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div className={styles.page}>
        <div className={styles.stack}>
          <section className={styles.hero}>
            <div className={styles.heroEyebrow}>Mobile workspace</div>
            <h1 className={styles.title}>Remote work</h1>
            <p className={styles.description}>
              Resume the right project fast, or switch teams without losing context.
            </p>
          </section>

          {activeOrg ? (
            <section className={`${styles.section} ${styles.resumeSection}`} aria-labelledby="mobile-resume-heading">
              {resumeProject ? (
                <div className={styles.resumeCard}>
                  <div id="mobile-resume-heading" className={styles.resumeEyebrow}>Resume</div>
                  <div className={styles.resumeTitle}>{resumeProject.name}</div>
                  <div className={styles.resumeCopy}>
                    {resumeAgent
                      ? `Resume ${resumeAgent.name}${resumeAgent.role?.trim() ? `, ${resumeAgent.role}` : ""}.`
                      : "Open the project to review progress or add a remote agent."}
                  </div>
                  <div className={styles.resumeMetaRow}>
                    <span className={styles.resumeMetaPill}>
                      <FolderKanban size={14} />
                      {formatStatus(resumeProject.current_status)}
                    </span>
                    <span className={styles.resumeMetaPill}>
                      <Sparkles size={14} />
                      {resumeProjectAgents.length > 0 ? `${resumeProjectAgents.length} agents ready` : "No agents yet"}
                    </span>
                  </div>
                  <div className={styles.resumeActions}>
                    <Button
                      variant="primary"
                      onClick={() => openProjectWorkspace(resumeProject.project_id)}
                    >
                      {resumeAgent ? `Chat with ${resumeAgent.name}` : "Open Project"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => navigate(
                        resumeProjectAgents.length > 0
                          ? projectTasksRoute(resumeProject.project_id)
                          : projectAgentCreateRoute(resumeProject.project_id),
                      )}
                    >
                      {resumeProjectAgents.length > 0 ? "Tasks" : "Add Agent"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyWorkspaceCard}>
                  <div id="mobile-resume-heading" className={styles.resumeEyebrow}>Resume</div>
                  <div className={styles.emptyWorkspaceTitle}>No project ready yet</div>
                  <div className={styles.emptyWorkspaceCopy}>
                    Start a new project for this organization so mobile users can jump straight into remote-agent work.
                  </div>
                  <Button variant="primary" onClick={openCreateProject}>
                    Create Project
                  </Button>
                </div>
              )}
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby="mobile-org-switcher-heading">
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <span id="mobile-org-switcher-heading" className={styles.sectionHeading}>Switch Team</span>
              </div>
              <span className={styles.sectionMeta}>{orgs.length}</span>
            </div>

            {orgs.length > 0 ? (
              <div className={styles.orgList} role="list" aria-label="Mobile organizations">
                {orgs.map((org) => {
                  const isActive = org.org_id === activeOrg?.org_id;
                  const isPending = switchingOrgId === org.org_id && !isActive;
                  return (
                    <button
                      key={org.org_id}
                      type="button"
                      role="listitem"
                      className={`${styles.orgButton} ${isActive ? styles.orgButtonActive : ""} ${isPending ? styles.orgButtonPending : ""}`}
                      aria-pressed={isActive}
                      onClick={() => handleSwitch(org)}
                    >
                      <span className={styles.orgInfo}>
                        <span className={styles.orgName}>{org.name}</span>
                        {isActive || isPending ? (
                          <span className={styles.orgMeta}>
                            {isActive ? "Current organization" : "Switching and reopening work..."}
                          </span>
                        ) : null}
                      </span>
                      <span className={styles.orgIcon}>
                        {isActive ? <Check size={16} /> : <ChevronRight size={16} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Text variant="muted" size="sm">
                Create your first team to unlock projects, agents, and mobile workspaces.
              </Text>
            )}
            <div className={styles.actions}>
              {canCreateProject ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<FolderKanban size={16} />}
                  className={styles.actionButton}
                  onClick={openCreateProject}
                >
                  New Project
                </Button>
              ) : null}
              <Button
                variant={orgs.length === 0 ? "primary" : "ghost"}
                size="sm"
                icon={<Plus size={16} />}
                className={styles.actionButton}
                onClick={() => setCreateOpen(true)}
                >
                  {orgs.length === 0 ? "Create Team" : "New Team"}
                </Button>
              </div>
            <div className={styles.footerActions}>
              <Button
                variant="ghost"
                size="sm"
                icon={<Building2 size={16} />}
                className={styles.actionButton}
                onClick={openOrgSettings}
              >
                Team settings
              </Button>
              <Button
                variant="ghost"
                size="sm"
                icon={<Settings size={16} />}
                className={styles.actionButton}
                onClick={openSettings}
              >
                App settings
              </Button>
            </div>
          </section>
        </div>
      </div>
      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (creating) return;
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="Create Team"
        size="sm"
        initialFocusRef={initialFocusRef}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void handleCreateOrg()} disabled={creating || !teamName.trim()}>
              {creating ? "Creating..." : "Create"}
            </Button>
          </>
        )}
      >
        <Input
          ref={inputRef}
          value={teamName}
          placeholder="Team name"
          autoFocus={autoFocus}
          onChange={(event) => setTeamName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreateOrg();
            }
          }}
        />
        {createError ? <Text size="sm">{createError}</Text> : null}
      </Modal>
    </>
  );
}
