import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate, useOutlet } from "react-router-dom";
import { Topbar, Drawer, Button, ButtonPlus } from "@cypher-asi/zui";
import { ArrowLeft, Brain, Building2, CheckSquare, ChevronDown, CircleUserRound, FolderOpen, GitCommitVertical, Server, Settings, Trophy } from "lucide-react";
import { Lane } from "./Lane";
import { AppNavRail } from "./AppNavRail";
import { BottomTaskbar } from "./BottomTaskbar";
import { SettingsModal } from "./SettingsModal";
import { HostSettingsModal } from "./HostSettingsModal";
import { UpdateBanner } from "./UpdateBanner";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { PanelSearch } from "./PanelSearch";
import { WindowControls } from "./WindowControls";
import { ProjectList } from "./ProjectList";
import { OrgProvider } from "../context/OrgContext";
import { AppProvider, useAppContext } from "../context/AppContext";
import { SidebarSearchProvider, useSidebarSearch } from "../context/SidebarSearchContext";
import { useSidekick } from "../context/SidekickContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { useProjectContext } from "../context/ProjectContext";
import { ProjectsProvider } from "../apps/projects/ProjectsProvider";
import { useProjectsList } from "../apps/projects/useProjectsList";
import { AgentAppProvider } from "../apps/agents/AgentAppProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { LeaderboardProvider } from "../apps/leaderboard/LeaderboardContext";
import { ProfileProvider } from "../apps/profile/ProfileProvider";
import { apps } from "../apps/registry";
import { NewProjectModal } from "./NewProjectModal";
import { windowCommand } from "../lib/windowCommand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";
import { getLastAgent } from "../utils/storage";
import {
  getMobileProjectDestination,
  getProjectIdFromPathname,
  isProjectSubroute,
  projectAgentRoute,
  projectFilesRoute,
  projectRootPath,
  projectWorkRoute,
} from "../utils/mobileNavigation";
import styles from "./AppShell.module.css";

function previewItemKey(item: ReturnType<typeof useSidekick>["previewItem"]): string | null {
  if (!item) return null;
  switch (item.kind) {
    case "spec":
      return `spec:${item.spec.spec_id}`;
    case "specs_overview":
      return `specs:${item.specs.map((spec) => spec.spec_id).join(",")}`;
    case "task":
      return `task:${item.task.task_id}`;
    case "session":
      return `session:${item.session.session_id}`;
    case "log":
      return `log:${item.entry.timestamp}:${item.entry.summary}`;
  }
}

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) {
    active.blur();
  }
}

function SidekickLaneInner() {
  const { activeApp } = useAppContext();
  const { SidekickPanel, SidekickTaskbar, SidekickHeader: SidekickHeaderComp } = activeApp;

  if (!SidekickPanel) return null;

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      minWidth={200}
      maxWidth={1200}
      storageKey="aura-sidekick-v2"
      header={SidekickTaskbar && <SidekickTaskbar />}
      taskbar={SidekickHeaderComp && <SidekickHeaderComp />}
      style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
    >
      <SidekickPanel />
    </Lane>
  );
}

function SidekickLane() {
  const { activeApp } = useAppContext();
  return <SidekickLaneInner key={activeApp.id} />;
}

function PreviewLane() {
  const { activeApp } = useAppContext();
  const { PreviewPanel, PreviewHeader: PreviewHeaderComp } = activeApp;
  const { previewItem } = useSidekick();

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      maxWidth={1200}
      storageKey="aura-preview"
      collapsible
      collapsed={!previewItem}
      header={PreviewHeaderComp && <PreviewHeaderComp />}
      style={{ boxShadow: "-1px 0 0 0 var(--color-border)" }}
    >
      {PreviewPanel && <PreviewPanel />}
    </Lane>
  );
}

function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const { activeApp } = useAppContext();

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search..."}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}

function ProjectCreationModalHost() {
  const navigate = useNavigate();
  const sidekick = useSidekick();
  const { setProjects, newProjectModalOpen, closeNewProjectModal } = useProjectsList();

  const handleProjectCreated = useCallback((project: import("../types").Project) => {
    closeNewProjectModal();
    sidekick.closePreview();
    setProjects((prev) => [...prev, project]);
    navigate(`/projects/${project.project_id}`);
  }, [closeNewProjectModal, navigate, setProjects, sidekick]);

  return (
    <NewProjectModal
      isOpen={newProjectModalOpen}
      onClose={closeNewProjectModal}
      onCreated={handleProjectCreated}
    />
  );
}

type MobileNavId = "agent" | "tasks" | "files" | "feed";

const MOBILE_NAV_ITEMS: Array<{ id: MobileNavId; label: string; icon: typeof Brain }> = [
  { id: "agent", label: "Agent", icon: Brain },
  { id: "tasks", label: "Tasks", icon: CheckSquare },
  { id: "files", label: "Files", icon: FolderOpen },
  { id: "feed", label: "Feed", icon: GitCommitVertical },
];

function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch();
  const { openNewProjectModal } = useProjectsList();

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <PanelSearch
          placeholder="Search Projects..."
          value={query}
          onChange={setQuery}
          action={<ButtonPlus onClick={openNewProjectModal} size="sm" title="New Project" />}
        />
      </div>
      <div className={styles.mobileDrawerBody}>
        <ProjectList />
      </div>
    </div>
  );
}

function AccountSheetContent({
  onOpenProfile,
  onOpenLeaderboard,
  onOpenOrgSettings,
  onOpenSettings,
}: {
  onOpenProfile: () => void;
  onOpenLeaderboard: () => void;
  onOpenOrgSettings: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileDrawerActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<CircleUserRound size={16} />}
            className={styles.mobileDrawerAction}
            onClick={onOpenProfile}
          >
            Profile
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trophy size={16} />}
            className={styles.mobileDrawerAction}
            onClick={onOpenLeaderboard}
          >
            Leaderboard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Building2 size={16} />}
            className={styles.mobileDrawerAction}
            onClick={onOpenOrgSettings}
          >
            Team settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Settings size={16} />}
            className={styles.mobileDrawerAction}
            onClick={onOpenSettings}
          >
            App settings
          </Button>
        </div>
      </div>
    </div>
  );
}

function MobileBottomNav({
  activeId,
  onNavigate,
}: {
  activeId: MobileNavId | null;
  onNavigate: (id: MobileNavId) => void;
}) {
  return (
    <nav className={styles.mobileNavBar} aria-label="Primary mobile navigation">
      {MOBILE_NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={styles.mobileNavButton}
          data-active={activeId === item.id ? "true" : "false"}
          onClick={() => onNavigate(item.id)}
          type="button"
          aria-pressed={activeId === item.id}
        >
          <item.icon size={18} />
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function PreviewSheetContent() {
  const { activeApp } = useAppContext();
  const { PreviewPanel, PreviewHeader: PreviewHeaderComp } = activeApp;

  if (!PreviewPanel) return null;

  return (
    <div className={styles.mobileDrawerContent}>
      {PreviewHeaderComp && (
        <div className={styles.mobileContextHeader}>
          <PreviewHeaderComp />
        </div>
      )}
      <div className={styles.mobileDrawerBody}>
        <PreviewPanel />
      </div>
    </div>
  );
}

function ResponsiveShell({
  onOpenOrgSettings,
  onOpenSettings,
  onBuyCredits,
}: {
  onOpenOrgSettings: () => void;
  onOpenSettings: () => void;
  onBuyCredits: () => void;
}) {
  const { activeApp } = useAppContext();
  const { features, isMobileLayout, isPhoneLayout } = useAuraCapabilities();
  const { previewItem } = useSidekick();
  const projectContext = useProjectContext();
  const { projects, mostRecentProject } = useProjectsList();
  const routeContent = useOutlet();
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);
  const {
    MainPanel,
    ResponsiveControls,
    PreviewPanel,
  } = activeApp;
  const currentProjectId = getProjectIdFromPathname(location.pathname);
  const currentProject = projectContext?.project
    ?? projects.find((project) => project.project_id === currentProjectId)
    ?? null;
  const mobileDestination = getMobileProjectDestination(location.pathname);
  const lastAgent = getLastAgent();
  const recentProjectId = lastAgent && projects.some((project) => project.project_id === lastAgent.projectId)
    ? lastAgent.projectId
    : mostRecentProject?.project_id ?? projects[0]?.project_id ?? null;
  const mobileTargetProjectId = currentProjectId ?? recentProjectId;
  const currentProjectRootPath = currentProjectId ? projectRootPath(currentProjectId) : null;
  const isProjectRoute = Boolean(currentProjectId) && (
    location.pathname === currentProjectRootPath
      || isProjectSubroute(location.pathname, currentProjectId)
  );
  const showProjectTitle = Boolean(currentProjectId) && isProjectRoute;
  const showProjectBack = Boolean(currentProjectId) && isProjectRoute && location.pathname !== currentProjectRootPath;
  const showProjectResponsiveControls = isMobileLayout && activeApp.id !== "projects";

  useEffect(() => {
    if (isMobileLayout) return;
    const el = leftPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      document.documentElement.style.setProperty("--left-panel-width", `${w}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobileLayout]);

  useEffect(() => {
    if (!isMobileLayout) return;
    const frame = window.requestAnimationFrame(() => {
      setNavOpen(false);
      setPreviewOpen(false);
      setAccountOpen(false);
      setHostSettingsOpen(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isMobileLayout, location.pathname]);

  useEffect(() => {
    if (!isMobileLayout) return;
    if (!PreviewPanel || !previewItem) {
      const frame = window.requestAnimationFrame(() => setPreviewOpen(false));
      return () => window.cancelAnimationFrame(frame);
    }
  }, [PreviewPanel, isMobileLayout, previewItem]);

  useEffect(() => {
    if (!isMobileLayout) return;
    const key = previewItemKey(previewItem);

    if (!PreviewPanel || !key) {
      lastPreviewKeyRef.current = null;
      return;
    }

    if (lastPreviewKeyRef.current === key) {
      return;
    }

    lastPreviewKeyRef.current = key;
    const frame = window.requestAnimationFrame(() => {
      setAccountOpen(false);
      setPreviewOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [PreviewPanel, isMobileLayout, previewItem]);

  const drawerOpen = navOpen || previewOpen || accountOpen || hostSettingsOpen;
  const overlayDrawerOpen = navOpen || previewOpen || accountOpen;
  const closeDrawers = useCallback(() => {
    blurActiveElement();
    setNavOpen(false);
    setPreviewOpen(false);
    setAccountOpen(false);
  }, []);
  const openAfterDrawerClose = useCallback((callback: () => void) => {
    closeDrawers();
    window.setTimeout(callback, 180);
  }, [closeDrawers]);

  const handleMobilePrimaryNavigate = useCallback((id: MobileNavId) => {
    if (id === "feed") {
      navigate("/feed");
      return;
    }
    if (!mobileTargetProjectId) {
      navigate("/projects");
      return;
    }
    if (id === "agent") {
      navigate(projectAgentRoute(mobileTargetProjectId));
      return;
    }
    if (id === "tasks") {
      navigate(projectWorkRoute(mobileTargetProjectId));
      return;
    }
    navigate(projectFilesRoute(mobileTargetProjectId));
  }, [mobileTargetProjectId, navigate]);

  const topbar = isMobileLayout ? (
    <Topbar
      className={styles.mobileTopbar}
      icon={(
        <div className={styles.mobileTopbarSlot}>
          {showProjectBack && currentProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<ArrowLeft size={18} />}
              aria-label="Back to project"
              onClick={() => navigate(projectRootPath(currentProjectId))}
            />
          ) : null}
        </div>
      )}
      title={(
        <span className={styles.mobileTopbarTitle}>
          {showProjectTitle ? (
            <button
              type="button"
              className={styles.mobileProjectTitleButton}
              onClick={() => setNavOpen(true)}
              aria-label={currentProject ? `Open project navigation for ${currentProject.name}` : "Open project navigation"}
            >
              <span className={styles.mobileTopbarTitleText}>
                {currentProject?.name ?? "Project"}
              </span>
              <ChevronDown size={14} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.mobileTopbarTitleButton}
              onClick={() => setNavOpen(true)}
              aria-label="Open project navigation"
            >
              <span className={styles.mobileTopbarTitleText}>AURA</span>
            </button>
          )}
        </span>
      )}
      actions={(
        <div className={styles.mobileTopbarActions}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<CircleUserRound size={18} />}
            aria-label="Open account"
            onClick={() => setAccountOpen(true)}
          />
        </div>
      )}
    />
  ) : (
    <Topbar
      className="titlebar-drag"
      onDoubleClick={() => windowCommand("maximize")}
      icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
      title={<span className="titlebar-center"><Link to="/projects" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link></span>}
      actions={(
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          {features.hostRetargeting && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Server size={16} />}
              aria-label="Open host settings"
              onClick={() => setHostSettingsOpen(true)}
            />
          )}
          <WindowControls />
        </div>
      )}
    />
  );

  return (
    <>
      <div className={isMobileLayout ? `${styles.mobileShell} ${overlayDrawerOpen ? styles.mobileShellDimmed : ""}` : styles.desktopShell}>
        {topbar}
        <UpdateBanner />

        {isMobileLayout ? (
          <>
            <div className={styles.mobileMain}>
              {showProjectResponsiveControls && ResponsiveControls && (
                <div key={`${activeApp.id}-responsive-controls`} className={styles.mobileResponsiveControls}>
                  <ResponsiveControls />
                </div>
              )}
              <div className={styles.mobileMainPanel}>
                <MainPanel key={`${activeApp.id}-main-panel`}>
                  {routeContent}
                </MainPanel>
              </div>
            </div>

            {!drawerOpen && (
              <div className={styles.mobileBottomNav}>
                <MobileBottomNav activeId={mobileDestination} onNavigate={handleMobilePrimaryNavigate} />
              </div>
            )}
          </>
        ) : (
          <div className={styles.desktopContent}>
            <div ref={leftPanelRef} className={styles.desktopSidebar}>
              <div className={styles.desktopSidebarBody}>
                <AppNavRail />
                <Lane
                  resizable
                  resizePosition="right"
                  defaultWidth={200}
                  maxWidth={600}
                  storageKey="aura-sidebar"
                  header={<SidebarSearchInput />}
                >
                  {apps.map((app) => (
                    <div
                      key={app.id}
                      style={{ display: app.id === activeApp.id ? "contents" : "none" }}
                    >
                      <app.LeftPanel />
                    </div>
                  ))}
                </Lane>
              </div>
              <BottomTaskbar
                onOpenOrgSettings={onOpenOrgSettings}
                onBuyCredits={onBuyCredits}
              />
            </div>

            <MainPanel>{routeContent}</MainPanel>
            <SidekickLane />
            {PreviewPanel && <PreviewLane />}
          </div>
        )}
      </div>

      {isMobileLayout && overlayDrawerOpen && (
        <button
          type="button"
          className={styles.mobileDrawerBackdrop}
          aria-label="Close drawer"
          onClick={closeDrawers}
        />
      )}

      {isMobileLayout && (
        <>
          <Drawer
            side="left"
            isOpen={navOpen}
            onClose={() => {
              blurActiveElement();
              setNavOpen(false);
            }}
            title="Aura"
            className={styles.mobileNavDrawer}
            showMinimizedBar={false}
            defaultSize={356}
            maxSize={404}
          >
            {navOpen && <ProjectNavigationDrawerContent />}
          </Drawer>

          {PreviewPanel && (
            <Drawer
              side={isPhoneLayout ? "bottom" : "right"}
              isOpen={previewOpen}
              onClose={() => {
                blurActiveElement();
                setPreviewOpen(false);
              }}
              title="Preview"
              className={isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet}
              showMinimizedBar={false}
              defaultSize={isPhoneLayout ? 420 : 360}
              maxSize={isPhoneLayout ? 640 : 480}
            >
              <PreviewSheetContent />
            </Drawer>
          )}

          <Drawer
            side={isPhoneLayout ? "bottom" : "right"}
            isOpen={accountOpen}
            onClose={() => {
              blurActiveElement();
              setAccountOpen(false);
            }}
            title="Account"
            className={isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet}
            showMinimizedBar={false}
            defaultSize={isPhoneLayout ? 320 : 360}
            maxSize={isPhoneLayout ? 420 : 440}
          >
            <AccountSheetContent
              onOpenProfile={() => openAfterDrawerClose(() => navigate("/profile"))}
              onOpenLeaderboard={() => openAfterDrawerClose(() => navigate("/leaderboard"))}
              onOpenOrgSettings={() => openAfterDrawerClose(onOpenOrgSettings)}
              onOpenSettings={() => openAfterDrawerClose(onOpenSettings)}
            />
          </Drawer>
        </>
      )}

      <HostSettingsModal
        isOpen={hostSettingsOpen}
        onClose={() => {
          blurActiveElement();
          setHostSettingsOpen(false);
        }}
      />
    </>
  );
}

function AppContent() {
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgInitialSection, setOrgInitialSection] = useState<"billing" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openOrgBilling = useCallback(() => {
    setOrgInitialSection("billing");
    setOrgSettingsOpen(true);
  }, []);

  useEffect(() => {
    const handler = () => openOrgBilling();
    window.addEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
    return () => window.removeEventListener(INSUFFICIENT_CREDITS_EVENT, handler);
  }, [openOrgBilling]);

  return (
    <>
      <ResponsiveShell
        onOpenOrgSettings={() => setOrgSettingsOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onBuyCredits={openOrgBilling}
      />

      <OrgSettingsPanel
        isOpen={orgSettingsOpen}
        onClose={() => { setOrgSettingsOpen(false); setOrgInitialSection(undefined); }}
        initialSection={orgInitialSection}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ProjectCreationModalHost />
    </>
  );
}

export function AppShell() {
  return (
    <OrgProvider>
      <AppProvider apps={apps}>
        <SidebarSearchProvider>
          <ProjectsProvider>
            <AgentAppProvider>
              <FeedProvider>
                <LeaderboardProvider>
                  <ProfileProvider>
                    <AppContent />
                  </ProfileProvider>
                </LeaderboardProvider>
              </FeedProvider>
            </AgentAppProvider>
          </ProjectsProvider>
        </SidebarSearchProvider>
      </AppProvider>
    </OrgProvider>
  );
}
