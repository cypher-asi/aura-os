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
import { AgentAppProvider } from "../apps/agents/AgentAppProvider";
import { FeedProvider } from "../apps/feed/FeedProvider";
import { LeaderboardProvider } from "../apps/leaderboard/LeaderboardContext";
import { ProfileProvider } from "../apps/profile/ProfileProvider";
import { apps } from "../apps/registry";
import { windowCommand } from "../lib/windowCommand";
import { INSUFFICIENT_CREDITS_EVENT } from "../api/client";
import styles from "./AppShell.module.css";

const useAlwaysOpen = () => false;

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

function SidekickLaneInner() {
  const { activeApp } = useAppContext();
  const { SidekickPanel, SidekickTaskbar, SidekickHeader: SidekickHeaderComp } = activeApp;
  const useCollapsed = activeApp.useSidekickCollapsed ?? useAlwaysOpen;
  const collapsed = useCollapsed();

  if (!SidekickPanel) return null;

  return (
    <Lane
      resizable
      resizePosition="left"
      defaultWidth={320}
      maxWidth={1200}
      storageKey="aura-sidekick"
      collapsible={!!activeApp.useSidekickCollapsed}
      collapsed={collapsed}
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

interface ShellChromeProps {
  onOpenOrgSettings: () => void;
  onBuyCredits: () => void;
}

function DesktopShell({ onOpenOrgSettings, onBuyCredits }: ShellChromeProps) {
  const { activeApp } = useAppContext();
  const { MainPanel } = activeApp;
  const leftPanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = leftPanelRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      document.documentElement.style.setProperty("--left-panel-width", `${w}px`);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Topbar
        className="titlebar-drag"
        onDoubleClick={() => windowCommand("maximize")}
        icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
        title={<span className="titlebar-center"><Link to="/projects" style={{ color: "inherit", textDecoration: "none" }}>AURA</Link></span>}
        actions={<WindowControls />}
      />

      <UpdateBanner />

      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <div ref={leftPanelRef} style={{ display: "flex", flexDirection: "column", flexShrink: 0 }}>
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
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
        {activeApp.PreviewPanel && <PreviewLane />}
      </div>
    </div>
  );
}

function MobileShell({
  onOpenOrgSettings,
  onOpenSettings,
  onBuyCredits,
}: ShellChromeProps & { onOpenSettings: () => void }) {
  const { apps: registeredApps, activeApp } = useAppContext();
  const { status: hostStatus } = useHost();
  const { previewItem } = useSidekick();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const { MainPanel, SidekickPanel, SidekickTaskbar, SidekickHeader: SidekickHeaderComp, PreviewPanel, PreviewHeader: PreviewHeaderComp } = activeApp;
  const lastPreviewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setNavOpen(false);
    setContextOpen(false);
    setPreviewOpen(false);
    setHostSettingsOpen(false);
  }, [location.pathname]);

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

  useEffect(() => {
    if (!PreviewPanel || !previewItem) {
      setPreviewOpen(false);
    }
  }, [PreviewPanel, previewItem]);

  useEffect(() => {
    const key = previewItemKey(previewItem);

    if (!PreviewPanel || !key) {
      lastPreviewKeyRef.current = null;
      return;
    }

    if (lastPreviewKeyRef.current === key) {
      return;
    }

    lastPreviewKeyRef.current = key;
    setContextOpen(false);
    setPreviewOpen(true);
  }, [PreviewPanel, previewItem]);

  const drawerOpen = navOpen || contextOpen || previewOpen || hostSettingsOpen;
  const openAfterDrawerClose = useCallback((callback: () => void) => {
    setNavOpen(false);
    window.setTimeout(callback, 0);
  }, []);

  return (
    <>
      <div className={styles.mobileShell}>
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
            <div className={styles.mobileTitleBlock}>
              <span className={styles.mobileEyebrow}>Aura Companion</span>
              <span className={styles.mobileTitle}>{activeApp.label}</span>
            </div>
          )}
          actions={(
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
              <Badge variant={hostBadgeVariant[hostStatus]}>
                {hostBadgeText[hostStatus]}
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
                  onClick={() => setContextOpen(true)}
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

        <UpdateBanner />

        <div className={styles.mobileMain}>
          <MainPanel />
        </div>

        {!drawerOpen && (
          <nav className={styles.mobileBottomNav} aria-label="Primary navigation">
            {registeredApps.map((app) => (
              <button
                key={app.id}
                type="button"
                className={`${styles.mobileNavButton} ${activeApp.id === app.id ? styles.mobileNavButtonActive : ""}`}
                onClick={() => navigate(app.basePath)}
                aria-current={activeApp.id === app.id ? "page" : undefined}
              >
                <app.icon size={18} />
                <span className={styles.mobileNavLabel}>{app.label}</span>
              </button>
            ))}
          </nav>
        )}
      </div>

      <Drawer
        side="left"
        isOpen={navOpen}
        onClose={() => setNavOpen(false)}
        title={activeApp.label}
        className={styles.mobileNavDrawer}
        defaultSize={340}
        maxSize={420}
      >
        <div className={styles.mobileDrawerContent}>
          <div className={styles.mobileDrawerSearch}>
            <SidebarSearchInput />
          </div>
          <div className={styles.mobileDrawerBody}>
            <activeApp.LeftPanel />
          </div>
          <div className={styles.mobileDrawerFooter}>
            <OrgSelector onOpenSettings={onOpenOrgSettings} />
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
      </Drawer>

      {SidekickPanel && (
        <Drawer
          side="bottom"
          isOpen={contextOpen}
          onClose={() => setContextOpen(false)}
          title={`${activeApp.label} details`}
          className={styles.mobileSheetDrawer}
          defaultSize={440}
          maxSize={640}
        >
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
        </Drawer>
      )}

      {PreviewPanel && (
        <Drawer
          side="bottom"
          isOpen={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title="Preview"
          className={styles.mobileSheetDrawer}
          defaultSize={420}
          maxSize={640}
        >
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
        </Drawer>
      )}

      <HostSettingsModal isOpen={hostSettingsOpen} onClose={() => setHostSettingsOpen(false)} />
    </>
  );
}

function AppContent() {
  const [orgSettingsOpen, setOrgSettingsOpen] = useState(false);
  const [orgInitialSection, setOrgInitialSection] = useState<"billing" | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { isMobileLayout } = useAuraCapabilities();

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
      {isMobileLayout ? (
        <MobileShell
          onOpenOrgSettings={() => setOrgSettingsOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onBuyCredits={openOrgBilling}
        />
      ) : (
        <DesktopShell
          onOpenOrgSettings={() => setOrgSettingsOpen(true)}
          onBuyCredits={openOrgBilling}
        />
      )}

      <OrgSettingsPanel
        isOpen={orgSettingsOpen}
        onClose={() => { setOrgSettingsOpen(false); setOrgInitialSection(undefined); }}
        initialSection={orgInitialSection}
      />
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
