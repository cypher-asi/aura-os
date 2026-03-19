import { useState, useCallback, useEffect, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Topbar, Drawer, Badge, Button } from "@cypher-asi/zui";
import { Building2, Eye, Menu, Rows3, Server, Settings } from "lucide-react";
import { Lane } from "./Lane";
import { AppNavRail } from "./AppNavRail";
import { BottomTaskbar } from "./BottomTaskbar";
import { SettingsModal } from "./SettingsModal";
import { HostSettingsModal } from "./HostSettingsModal";
import { UpdateBanner } from "./UpdateBanner";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { PanelSearch } from "./PanelSearch";
import { OrgSelector } from "./OrgSelector";
import { CreditsBadge } from "./CreditsBadge";
import { WindowControls } from "./WindowControls";
import { OrgProvider } from "../context/OrgContext";
import { AppProvider, useAppContext } from "../context/AppContext";
import { SidebarSearchProvider, useSidebarSearch } from "../context/SidebarSearchContext";
import { useSidekick } from "../context/SidekickContext";
import { useHost, type HostConnectionStatus } from "../context/HostContext";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
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

const hostBadgeVariant: Record<HostConnectionStatus, "running" | "pending" | "error"> = {
  checking: "pending",
  online: "running",
  auth_required: "pending",
  unreachable: "error",
  error: "error",
};

const hostBadgeText: Record<HostConnectionStatus, string> = {
  checking: "Checking host",
  online: "Host online",
  auth_required: "Sign in required",
  unreachable: "Host unreachable",
  error: "Host error",
};

const mobileHostBadgeText: Record<HostConnectionStatus, string> = {
  checking: "Checking",
  online: "Online",
  auth_required: "Sign in",
  unreachable: "Offline",
  error: "Error",
};

function NavigationDrawerContent({
  onOpenOrgSettings,
  onOpenSettings,
  onBuyCredits,
  openAfterDrawerClose,
}: {
  onOpenOrgSettings: () => void;
  onOpenSettings: () => void;
  onBuyCredits: () => void;
  openAfterDrawerClose: (callback: () => void) => void;
}) {
  const { activeApp } = useAppContext();

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <SidebarSearchInput />
      </div>
      <div className={styles.mobileDrawerBody}>
        <activeApp.LeftPanel />
      </div>
      <div className={styles.mobileDrawerFooter}>
        <OrgSelector onOpenSettings={onOpenOrgSettings} variant="drawer" />
        <CreditsBadge onClick={onBuyCredits} />
        <div className={styles.mobileDrawerActions}>
          <Button
            variant="ghost"
            size="sm"
            icon={<Building2 size={14} />}
            className={styles.mobileDrawerAction}
            onClick={() => openAfterDrawerClose(onOpenOrgSettings)}
          >
            Team settings
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Settings size={14} />}
            className={styles.mobileDrawerAction}
            onClick={() => openAfterDrawerClose(onOpenSettings)}
          >
            App settings
          </Button>
        </div>
      </div>
    </div>
  );
}

function DetailsSheetContent() {
  const { activeApp } = useAppContext();
  const {
    SidekickPanel,
    SidekickTaskbar,
    SidekickHeader: SidekickHeaderComp,
  } = activeApp;

  if (!SidekickPanel) return null;

  return (
    <div className={styles.mobileDrawerContent}>
      {SidekickTaskbar && (
        <div className={styles.mobileContextHeader}>
          <SidekickTaskbar />
        </div>
      )}
      <div className={styles.mobileDrawerBody}>
        <SidekickPanel />
      </div>
      {SidekickHeaderComp && (
        <div className={styles.mobileContextHeader}>
          <SidekickHeaderComp />
        </div>
      )}
    </div>
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
  const { features, isMobileLayout } = useAuraCapabilities();
  const { status: hostStatus } = useHost();
  const { previewItem, setActiveTab } = useSidekick();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const lastPreviewKeyRef = useRef<string | null>(null);
  const {
    MainPanel,
    ResponsiveControls,
    SidekickPanel,
    PreviewPanel,
  } = activeApp;

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
      setContextOpen(false);
      setPreviewOpen(false);
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
      setContextOpen(false);
      setPreviewOpen(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [PreviewPanel, isMobileLayout, previewItem]);

  const drawerOpen = navOpen || contextOpen || previewOpen || hostSettingsOpen;
  const overlayDrawerOpen = navOpen || contextOpen || previewOpen;
  const closeDrawers = useCallback(() => {
    blurActiveElement();
    setNavOpen(false);
    setContextOpen(false);
    setPreviewOpen(false);
  }, []);
  const openAfterDrawerClose = useCallback((callback: () => void) => {
    closeDrawers();
    window.setTimeout(callback, 180);
  }, [closeDrawers]);

  const handleOpenContext = useCallback(() => {
    if (activeApp.id === "projects") {
      setActiveTab("tasks");
    }
    setContextOpen(true);
  }, [activeApp.id, setActiveTab]);

  const topbar = isMobileLayout ? (
    <Topbar
      className={styles.mobileTopbar}
      icon={
        <div className={styles.mobileTopbarInner}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Menu size={18} />}
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          />
          <img src="/aura-icon.png" alt="" className="titlebar-icon" />
        </div>
      }
      title={(
        <span className={styles.mobileTopbarTitle}>
          <Link to="/projects" className={styles.mobileTopbarTitleLink}>AURA</Link>
        </span>
      )}
      actions={(
        <div className={styles.mobileTopbarActions}>
          <Badge
            variant={hostBadgeVariant[hostStatus]}
            className={styles.mobileHostBadge}
            title={hostBadgeText[hostStatus]}
          >
            {mobileHostBadgeText[hostStatus]}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            icon={<Server size={16} />}
            aria-label="Open host settings"
            onClick={() => setHostSettingsOpen(true)}
          />
          {SidekickPanel && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Rows3 size={16} />}
              aria-label="Open details"
              onClick={handleOpenContext}
            />
          )}
          {PreviewPanel && previewItem && (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Eye size={16} />}
              aria-label="Open preview"
              onClick={() => setPreviewOpen(true)}
            />
          )}
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
              {ResponsiveControls && (
                <div key={`${activeApp.id}-responsive-controls`} className={styles.mobileResponsiveControls}>
                  <ResponsiveControls />
                </div>
              )}
              <div className={styles.mobileMainPanel}>
                <MainPanel key={`${activeApp.id}-main-panel`} />
              </div>
            </div>

            {!drawerOpen && (
              <div className={styles.mobileBottomNav}>
                <AppNavRail layout="bar" />
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

            <MainPanel />
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
            {navOpen && (
              <NavigationDrawerContent
                onOpenOrgSettings={onOpenOrgSettings}
                onOpenSettings={onOpenSettings}
                onBuyCredits={onBuyCredits}
                openAfterDrawerClose={openAfterDrawerClose}
              />
            )}
          </Drawer>

          {SidekickPanel && (
            <Drawer
              side="bottom"
              isOpen={contextOpen}
              onClose={() => {
                blurActiveElement();
                setContextOpen(false);
              }}
              title={`${activeApp.label} details`}
              className={styles.mobileSheetDrawer}
              showMinimizedBar={false}
              defaultSize={440}
              maxSize={640}
            >
              <DetailsSheetContent />
            </Drawer>
          )}

          {PreviewPanel && (
            <Drawer
              side="bottom"
              isOpen={previewOpen}
              onClose={() => {
                blurActiveElement();
                setPreviewOpen(false);
              }}
              title="Preview"
              className={styles.mobileSheetDrawer}
              showMinimizedBar={false}
              defaultSize={420}
              maxSize={640}
            >
              <PreviewSheetContent />
            </Drawer>
          )}
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
