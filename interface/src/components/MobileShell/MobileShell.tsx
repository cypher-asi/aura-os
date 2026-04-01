import { Fragment, useCallback, useMemo } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router-dom";
import { Topbar, Drawer, Button, ButtonPlus, Text } from "@cypher-asi/zui";
import { useShallow } from "zustand/react/shallow";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  ArrowLeft, ChevronDown, CircleUserRound,
  Settings, Building2, Server, FolderOpen, Bot, GitCommitVertical, Gem, Menu,
} from "lucide-react";
import { PanelSearch } from "../PanelSearch";
import { UpdateBanner } from "../UpdateBanner";
import { MobileBottomNav, type MobileNavId } from "../MobileBottomNav";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import { useMobileDrawerEffects } from "../../hooks/use-mobile-drawers";
import { getRecentProjects, useProjectsListStore } from "../../stores/projects-list-store";
import { useMobileDrawerStore, selectDrawerOpen, selectOverlayDrawerOpen } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useSidekick } from "../../stores/sidekick-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { HostSettingsModal } from "../HostSettingsModal";
import { MobileAgentLibraryView } from "../../apps/agents/MobileAgentLibraryView";
import { MobileAgentDetailsView } from "../../apps/agents/MobileAgentDetailsView";
import {
  getMobileProjectDestination,
  getProjectIdFromPathname,
  projectAgentRoute,
  projectStatsRoute,
  projectRootPath,
  projectWorkRoute,
} from "../../utils/mobileNavigation";
import { useMobileShellState } from "./useMobileShellState";
import styles from "../AppShell/AppShell.module.css";

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch();
  const { openNewProjectModal, projects } = useProjectsListStore(
    useShallow((state) => ({
      openNewProjectModal: state.openNewProjectModal,
      projects: state.projects,
    })),
  );
  const navigate = useNavigate();
  const location = useLocation();
  const sidekick = useSidekick();
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const mobileDestination = getMobileProjectDestination(location.pathname);
  const recentProjects = useMemo(() => getRecentProjects(projects), [projects]);

  const filteredProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = `${project.name} ${project.description ?? ""}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [projects, query]);

  const openProjectLanding = useCallback((projectId: string) => {
    if (projectId !== currentProjectId) {
      sidekick.closePreview();
    }

    openAfterDrawerClose(() => {
      if (mobileDestination === "tasks") {
        navigate(projectWorkRoute(projectId));
        return;
      }

      if (mobileDestination === "stats") {
        navigate(projectStatsRoute(projectId));
        return;
      }

      navigate(projectAgentRoute(projectId));
    });
  }, [currentProjectId, mobileDestination, navigate, openAfterDrawerClose, sidekick]);

  const currentProject = currentProjectId
    ? projects.find((project) => project.project_id === currentProjectId) ?? null
    : null;

  const activeQuery = query.trim();
  const recentProjectIds = new Set(recentProjects.map((project) => project.project_id));
  const recentRows = filteredProjects.filter((project) =>
    project.project_id !== currentProjectId && recentProjectIds.has(project.project_id),
  );
  const remainingRows = filteredProjects.filter((project) =>
    project.project_id !== currentProjectId && !recentProjectIds.has(project.project_id),
  );
  const hasCurrentProject = Boolean(currentProjectId);
  const recentSectionTitle = hasCurrentProject || remainingRows.length > 0 ? "Recent projects" : "Projects";
  const remainingSectionTitle = recentRows.length > 0 ? "Other projects" : "Projects";

  const renderProjectRow = (project: typeof projects[number]) => {
    const isActive = project.project_id === currentProjectId;

    return (
      <button
        key={project.project_id}
        type="button"
        className={`${styles.mobileProjectDrawerRow} ${isActive ? styles.mobileProjectDrawerRowActive : ""}`}
        aria-label={`Open ${project.name}`}
        onClick={() => openProjectLanding(project.project_id)}
      >
        <span className={styles.mobileProjectDrawerRowMain}>
          <span className={styles.mobileProjectDrawerTitle}>{project.name}</span>
          <span className={styles.mobileProjectDrawerRowMeta}>
            {project.description?.trim() || "Open this project."}
          </span>
        </span>
      </button>
    );
  };

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <PanelSearch
          placeholder="Search Projects..."
          value={query}
          onChange={setQuery}
          action={<ButtonPlus onClick={() => openAfterDrawerClose(openNewProjectModal)} size="sm" title="New Project" />}
        />
      </div>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileProjectDrawerList} role="tree" aria-label="Project navigation">
          {currentProject && (!activeQuery || filteredProjects.some((project) => project.project_id === currentProject.project_id)) ? (
            <section className={styles.mobileDrawerSection}>
              <div className={styles.mobileDrawerSectionHeader}>
                <span className={styles.mobileDrawerSectionTitle}>Current project</span>
              </div>
              <section
                className={`${styles.mobileProjectDrawerCard} ${styles.mobileProjectDrawerCardActive}`}
              >
                <button
                  type="button"
                  role="treeitem"
                  aria-label={currentProject.name}
                  aria-selected
                  className={styles.mobileProjectDrawerPrimary}
                  onClick={() => openProjectLanding(currentProject.project_id)}
                >
                  <span className={styles.mobileProjectDrawerTitle}>{currentProject.name}</span>
                  <span className={styles.mobileProjectDrawerDescription}>
                    {currentProject.description?.trim() || "Open this project and keep working in the current tab."}
                  </span>
                </button>
              </section>
            </section>
          ) : null}

          {activeQuery ? (
            <section className={styles.mobileDrawerSection}>
              <div className={styles.mobileDrawerSectionHeader}>
                <span className={styles.mobileDrawerSectionTitle}>Results</span>
                <span className={styles.mobileDrawerSectionCount}>{filteredProjects.length}</span>
              </div>
              <div className={styles.mobileProjectDrawerStack}>
                {filteredProjects
                  .filter((project) => project.project_id !== currentProjectId)
                  .map(renderProjectRow)}
              </div>
            </section>
          ) : (
            <>
              {recentRows.length > 0 ? (
                <section className={styles.mobileDrawerSection}>
                  <div className={styles.mobileDrawerSectionHeader}>
                    <span className={styles.mobileDrawerSectionTitle}>{recentSectionTitle}</span>
                    <span className={styles.mobileDrawerSectionCount}>{recentRows.length}</span>
                  </div>
                  <div className={styles.mobileProjectDrawerStack}>
                    {recentRows.map(renderProjectRow)}
                  </div>
                </section>
              ) : null}

              {remainingRows.length > 0 ? (
                <section className={styles.mobileDrawerSection}>
                  <div className={styles.mobileDrawerSectionHeader}>
                    <span className={styles.mobileDrawerSectionTitle}>{remainingSectionTitle}</span>
                    <span className={styles.mobileDrawerSectionCount}>{remainingRows.length}</span>
                  </div>
                  <div className={styles.mobileProjectDrawerStack}>
                    {remainingRows.map(renderProjectRow)}
                  </div>
                </section>
              ) : null}
            </>
          )}

          {filteredProjects.length === 0 ? (
            <div className={styles.mobileDrawerEmptyState}>
              <Text variant="muted" size="sm">
                No projects match “{query}”.
              </Text>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function resolveGlobalProjectPath(state: ReturnType<typeof useMobileShellState>) {
  if (state.mobileDestination === "tasks" && state.mobileTargetProjectId) {
    return projectWorkRoute(state.mobileTargetProjectId);
  }

  if (state.mobileDestination === "stats" && state.mobileTargetProjectId) {
    return projectStatsRoute(state.mobileTargetProjectId);
  }

  if (state.mobileTargetProjectId) {
    return projectAgentRoute(state.mobileTargetProjectId);
  }

  return "/projects";
}

function resolveGlobalAgentsPath() {
  return "/agents";
}

function AppSwitcherContent({ state }: { state: ReturnType<typeof useMobileShellState> }) {
  const navigate = useNavigate();
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const activeAppId = state.activeApp.id;

  const items = [
    {
      id: "projects",
      label: "Projects",
      description: state.mobileTargetProject?.name ?? "Return to your current project",
      icon: FolderOpen,
      path: resolveGlobalProjectPath(state),
    },
    {
      id: "agents",
      label: "Agent library",
      description: "Browse shared agents",
      icon: Bot,
      path: resolveGlobalAgentsPath(),
    },
    {
      id: "feed",
      label: "Feed",
      description: "Activity across your projects",
      icon: GitCommitVertical,
      path: "/feed",
    },
    {
      id: "leaderboard",
      label: "Leaderboard",
      description: "Usage and ranking",
      icon: Gem,
      path: "/leaderboard",
    },
    {
      id: "profile",
      label: "Profile",
      description: "Your account and activity",
      icon: CircleUserRound,
      path: "/profile",
    },
  ] as const;

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileAppSwitcherList}>
          {items.map((item) => {
            const isSelected = item.id === "projects"
              ? activeAppId === "projects"
              : activeAppId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.mobileAppSwitcherButton} ${isSelected ? styles.mobileAppSwitcherButtonActive : ""}`}
                aria-pressed={isSelected}
                aria-label={item.label}
                onClick={() => openAfterDrawerClose(() => navigate(item.path))}
              >
                <span className={styles.mobileAppSwitcherIcon}>
                  <item.icon size={18} />
                </span>
                <span className={styles.mobileAppSwitcherText}>
                  <span className={styles.mobileAppSwitcherLabel}>{item.label}</span>
                  <span className={styles.mobileAppSwitcherDescription}>{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AccountSheetContent() {
  const { openAfterDrawerClose } = useMobileDrawerStore();
  const { features } = useAuraCapabilities();
  const { openOrgSettings, openSettings, openHostSettings } = useUIModalStore();
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileDrawerActions}>
          <Button variant="ghost" size="sm" icon={<Building2 size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openOrgSettings)}>Team settings</Button>
          {features.hostRetargeting ? (
            <Button variant="ghost" size="sm" icon={<Server size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openHostSettings)}>Host settings</Button>
          ) : null}
          <Button variant="ghost" size="sm" icon={<Settings size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openSettings)}>App settings</Button>
        </div>
      </div>
    </div>
  );
}

function PreviewSheetContent({ PreviewPanel, PreviewHeader }: { PreviewPanel: React.ComponentType; PreviewHeader?: React.ComponentType }) {
  return (
    <div className={styles.mobileDrawerContent}>
      {PreviewHeader && <div className={styles.mobileContextHeader}><PreviewHeader /></div>}
      <div className={styles.mobileDrawerBody}><PreviewPanel /></div>
    </div>
  );
}

function MobileTopbar({ state }: { state: ReturnType<typeof useMobileShellState> }) {
  const navigate = useNavigate();
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const setAppOpen = useMobileDrawerStore((s) => s.setAppOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);

  return (
    <Topbar
      className={styles.mobileTopbar}
      icon={
        <div className={styles.mobileTopbarSlot}>
          {state.isStandaloneAgentDetailRoute ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<ArrowLeft size={18} />}
              aria-label="Back to agent library"
              onClick={() => navigate("/agents")}
            />
          ) : state.showProjectBack && state.currentProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<ArrowLeft size={18} />}
              aria-label="Back to project"
              onClick={() => {
                if (state.currentProjectId) {
                  navigate(projectRootPath(state.currentProjectId));
                }
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.mobileAppSwitcherTrigger}
              aria-label="Open apps"
              onClick={() => setAppOpen(true)}
            >
              <Menu size={18} />
            </button>
          )}
        </div>
      }
      title={
        <span className={styles.mobileTopbarTitle}>
          {state.showProjectTitle ? (
            <button type="button" className={styles.mobileProjectTitleButton} onClick={() => setNavOpen(true)} aria-label={state.currentProject ? `Open project navigation for ${state.currentProject.name}` : "Open project navigation"}>
              <span className={styles.mobileTopbarTitleText}>{state.currentProject?.name ?? "Project"}</span>
              <ChevronDown size={14} />
            </button>
          ) : state.showGlobalTitle ? (
            <span className={styles.mobileTopbarTitleButton} aria-label={state.globalTitle}>
              <span className={styles.mobileTopbarTitleText}>{state.globalTitle}</span>
            </span>
          ) : (
            <span className={styles.mobileTopbarTitleButton} aria-label="Aura">
              <img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} />
            </span>
          )}
        </span>
      }
      actions={
        <div className={styles.mobileTopbarActions}>
          <Button variant="ghost" size="sm" iconOnly icon={<CircleUserRound size={18} />} aria-label="Open account" onClick={() => setAccountOpen(true)} />
        </div>
      }
    />
  );
}

export function MobileShell() {
  const state = useMobileShellState();
  const routeContent = useOutlet();
  const navigate = useNavigate();
  const { MainPanel, ResponsiveControls, PreviewPanel, PreviewHeader: PreviewHeaderComp } = state.activeApp;
  const ActiveProvider = state.activeApp.Provider ?? Fragment;

  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const appOpen = useMobileDrawerStore((s) => s.appOpen);
  const setAppOpen = useMobileDrawerStore((s) => s.setAppOpen);
  const previewOpen = useMobileDrawerStore((s) => s.previewOpen);
  const setPreviewOpen = useMobileDrawerStore((s) => s.setPreviewOpen);
  const accountOpen = useMobileDrawerStore((s) => s.accountOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const drawerOpen = useMobileDrawerStore(selectDrawerOpen);
  const overlayDrawerOpen = useMobileDrawerStore(selectOverlayDrawerOpen);
  const { hostSettingsOpen, closeHostSettings } = useUIModalStore();
  const mobileNavActiveId: MobileNavId | null = state.mobileDestination === "agent"
    || state.mobileDestination === "tasks"
    || state.mobileDestination === "stats"
    ? state.mobileDestination
    : null;

  useMobileDrawerEffects(Boolean(PreviewPanel));

  const handleMobilePrimaryNavigate = useCallback((id: MobileNavId) => {
    if (!state.mobileTargetProjectId) { navigate("/projects"); return; }
    if (id === "agent") { navigate(projectAgentRoute(state.mobileTargetProjectId)); return; }
    if (id === "tasks") { navigate(projectWorkRoute(state.mobileTargetProjectId)); return; }
    navigate(projectStatsRoute(state.mobileTargetProjectId));
  }, [state.mobileTargetProjectId, navigate]);

  return (
    <>
      <ActiveProvider>
        <div className={`${styles.mobileShell} ${overlayDrawerOpen ? styles.mobileShellDimmed : ""}`}>
          <MobileTopbar state={state} />
          <UpdateBanner />
          <div className={styles.mobileMain}>
            {state.showProjectResponsiveControls && ResponsiveControls && <div className={styles.mobileResponsiveControls}><ResponsiveControls /></div>}
            {state.isStandaloneAgentLibraryRoot ? (
              <div className={styles.mobileMainPanel}><ErrorBoundary name="main"><MobileAgentLibraryView /></ErrorBoundary></div>
            ) : state.isStandaloneAgentDetailRoute ? (
              <div className={styles.mobileMainPanel}><ErrorBoundary name="main"><MobileAgentDetailsView /></ErrorBoundary></div>
            ) : (
              <div className={styles.mobileMainPanel}><ErrorBoundary name="main"><MainPanel>{routeContent}</MainPanel></ErrorBoundary></div>
            )}
          </div>
          {!drawerOpen && state.showProjectTitle && (
            <div className={styles.mobileBottomNav}>
              <MobileBottomNav activeId={mobileNavActiveId} onNavigate={handleMobilePrimaryNavigate} />
            </div>
          )}
        </div>
        {overlayDrawerOpen && <button type="button" className={styles.mobileDrawerBackdrop} aria-label="Close drawer" onClick={closeDrawers} />}

        <Drawer side="left" isOpen={navOpen} onClose={() => { blurActiveElement(); setNavOpen(false); }} title="Aura" className={styles.mobileNavDrawer} showMinimizedBar={false} defaultSize={356} maxSize={404}>
          {navOpen && <ProjectNavigationDrawerContent />}
        </Drawer>

        <Drawer side={state.isPhoneLayout ? "bottom" : "right"} isOpen={appOpen} onClose={() => { blurActiveElement(); setAppOpen(false); }} title="Navigate" className={state.isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet} showMinimizedBar={false} defaultSize={state.isPhoneLayout ? 420 : 360} maxSize={state.isPhoneLayout ? 520 : 420}>
          <AppSwitcherContent state={state} />
        </Drawer>

        {PreviewPanel && (
          <Drawer side={state.isPhoneLayout ? "bottom" : "right"} isOpen={previewOpen} onClose={() => { blurActiveElement(); setPreviewOpen(false); }} title="Preview" className={state.isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet} showMinimizedBar={false} defaultSize={state.isPhoneLayout ? 420 : 360} maxSize={state.isPhoneLayout ? 640 : 480}>
            <PreviewSheetContent PreviewPanel={PreviewPanel} PreviewHeader={PreviewHeaderComp} />
          </Drawer>
        )}

        <Drawer side={state.isPhoneLayout ? "bottom" : "right"} isOpen={accountOpen} onClose={() => { blurActiveElement(); setAccountOpen(false); }} title="Account" className={state.isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet} showMinimizedBar={false} defaultSize={state.isPhoneLayout ? 320 : 360} maxSize={state.isPhoneLayout ? 420 : 440}>
          <AccountSheetContent />
        </Drawer>

        <HostSettingsModal
          isOpen={hostSettingsOpen}
          onClose={() => {
            blurActiveElement();
            closeHostSettings();
          }}
        />
      </ActiveProvider>
    </>
  );
}
