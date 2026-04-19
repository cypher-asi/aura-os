import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import {
  Building2,
  Check,
  ChevronRight,
  FolderKanban,
  Plus,
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
  const lastProjectId = getLastProject();
  const lastAgentEntry = getLastAgentEntry();
  const fallbackOrgId = useMemo(() => {
    if (activeOrg?.org_id) {
      return activeOrg.org_id;
    }

    if (lastProjectId) {
      const project = projects.find((candidate) => candidate.project_id === lastProjectId);
      if (project) {
        return project.org_id;
      }
    }

    if (lastAgentEntry) {
      const project = projects.find((candidate) => candidate.project_id === lastAgentEntry.projectId);
      if (project) {
        return project.org_id;
      }
    }

    return projects[0]?.org_id ?? null;
  }, [activeOrg?.org_id, lastAgentEntry, lastProjectId, projects]);
  const workspaceOrgId = activeOrg?.org_id ?? fallbackOrgId;
  const workspaceProjects = useMemo(
    () => (workspaceOrgId ? projects.filter((project) => project.org_id === workspaceOrgId) : []),
    [projects, workspaceOrgId],
  );
  const recentProjects = useMemo(
    () => getRecentProjects(workspaceProjects).slice(0, 3),
    [workspaceProjects],
  );
  const resumeProject = useMemo(() => {
    const byLastProject = lastProjectId
      ? workspaceProjects.find((project) => project.project_id === lastProjectId) ?? null
      : null;
    if (byLastProject) {
      return byLastProject;
    }

    const byLastAgent = lastAgentEntry
      ? workspaceProjects.find((project) => project.project_id === lastAgentEntry.projectId) ?? null
      : null;
    return byLastAgent ?? recentProjects[0] ?? null;
  }, [lastAgentEntry, lastProjectId, recentProjects, workspaceProjects]);
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
  const resumeAgentDisplayName = resumeAgent?.name?.trim() || null;
  const handleSwitch = (org: Org) => {
    setSwitchingOrgId(org.org_id);
    switchOrg(org);
    startTransition(() => {
      navigate("/projects", { replace: true });
    });
  };

  useEffect(() => {
    if (!activeOrg || loadingProjects || workspaceProjects.length > 0) {
      return;
    }
    void refreshProjects();
  }, [activeOrg, loadingProjects, refreshProjects, workspaceProjects.length]);

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
          {workspaceOrgId ? (
            <section className={`${styles.section} ${styles.resumeSection}`} aria-labelledby="mobile-resume-heading">
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  <h2 id="mobile-resume-heading" className={styles.sectionHeading}>Continue work</h2>
                  <span className={styles.sectionCopy}>
                    Pick up your latest project fast, or start a new workspace for this team.
                  </span>
                </div>
              </div>
              {resumeProject ? (
                <>
                  <div className={styles.resumeCard}>
                    <div className={styles.resumeEyebrow}>Last project</div>
                    <div className={styles.resumeTitle}>{resumeProject.name}</div>
                    <div className={styles.resumeCopy}>
                      {resumeAgent
                        ? `Continue with ${resumeAgentDisplayName ?? "your latest agent"}${resumeAgent.role?.trim() ? `, ${resumeAgent.role}` : ""}.`
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
                        className={styles.resumeActionButton}
                        onClick={() => openProjectWorkspace(resumeProject.project_id)}
                      >
                        {resumeAgent ? "Open chat" : "Open project"}
                      </Button>
                      <Button
                        variant="ghost"
                        className={styles.resumeActionButton}
                        onClick={() => navigate(
                          resumeProjectAgents.length > 0
                            ? projectTasksRoute(resumeProject.project_id)
                            : projectAgentCreateRoute(resumeProject.project_id),
                        )}
                      >
                        {resumeProjectAgents.length > 0 ? "View tasks" : "Add agent"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className={styles.emptyWorkspaceCard}>
                  <div className={styles.resumeEyebrow}>Projects</div>
                  <div className={styles.emptyWorkspaceTitle}>No project ready yet</div>
                  <div className={styles.emptyWorkspaceCopy}>
                    Start a new project for this organization so mobile users can jump straight into remote-agent work.
                  </div>
                  <Button variant="primary" className={styles.resumeActionButton} onClick={openCreateProject}>
                    Create Project
                  </Button>
                </div>
              )}
            </section>
          ) : null}

          {workspaceOrgId ? (
            <section className={styles.section} aria-labelledby="mobile-project-create-heading">
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  <h2 id="mobile-project-create-heading" className={styles.sectionHeading}>Start new work</h2>
                  <span className={styles.sectionCopy}>
                    Create a new project when you want a fresh remote workspace for this team.
                  </span>
                </div>
              </div>

              <Button
                variant="primary"
                icon={<FolderKanban size={16} />}
                className={styles.primaryActionButton}
                onClick={openCreateProject}
              >
                New Project
              </Button>
            </section>
          ) : null}

          <section className={styles.section} aria-labelledby="mobile-org-switcher-heading">
            <div className={styles.sectionHeader}>
              <div className={styles.sectionTitle}>
                <h2 id="mobile-org-switcher-heading" className={styles.sectionHeading}>Teams</h2>
                <span className={styles.sectionCopy}>
                  Switch the organization you want to work in on mobile.
                </span>
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
