import { getSettingsDestinationTitle, type SettingsDestination } from "./settings-destination";
import { MOBILE_MORE_NAV_ITEMS } from "../navigation/mobile-nav-items";
import { Fragment, Suspense, lazy, useCallback, useEffect, useState } from "react";
import { useNavigate, useOutlet } from "react-router-dom";
import { Button, Drawer, Text } from "@cypher-asi/zui";
import { ChevronLeft, X } from "lucide-react";
import { ErrorBoundary } from "../../components/ErrorBoundary";
import { ConversationSurfaceHost } from "../../components/ConversationSurfaceHost";
import { UpdateBanner } from "../../components/UpdateBanner";
import {
  MobileBottomNav,
  type MobileMoreNavId,
  type MobileNavId,
} from "../navigation";
import { useMobileDrawerEffects } from "../../hooks/use-mobile-drawers";
import { useMobileDrawerStore, selectDrawerOpen, selectOverlayDrawerOpen } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { projectAgentsRoute, projectFilesRoute, projectProcessRoute, projectStatsRoute, projectTasksRoute, projectWorkRoute } from "../../utils/mobileNavigation";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { getHostDisplayLabel } from "../../shared/lib/host-config";
import { useConversationRouteParams } from "../../apps/agents/hooks/use-conversation-route";
import { useMobileShellState } from "./useMobileShellState";
import { blurActiveElement } from "./mobile-shell-utils";
import { ProjectNavigationDrawerContent } from "./ProjectNavigationDrawer";
import { MobileTopbar } from "./MobileTopbar";
import {
  AccountSheetContent,
  PreviewSheetContent,
} from "./MobileDrawerContents";
import { useShallow } from "zustand/react/shallow";
import styles from "./MobileShell.module.css";

const HostSettingsModal = lazy(() =>
  import("../../components/HostSettingsModal").then((module) => ({ default: module.HostSettingsModal })),
);
const MobileAgentLibraryView = lazy(() =>
  import("../agents/MobileAgentLibraryView").then((module) => ({
    default: module.MobileAgentLibraryView,
  })),
);
const MobileAgentDetailsView = lazy(() =>
  import("../agents/MobileAgentDetailsView").then((module) => ({
    default: module.MobileAgentDetailsView,
  })),
);

export function MobileShell() {
  const state = useMobileShellState();
  const routeContent = useOutlet();
  const conversationRoute = useConversationRouteParams();
  const navigate = useNavigate();
  const { features } = useAuraCapabilities();
  const { MainPanel, ResponsiveControls, PreviewPanel, PreviewHeader: PreviewHeaderComp } = state.activeApp;
  const ActiveProvider = state.activeApp.Provider ?? Fragment;

  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const previewOpen = useMobileDrawerStore((s) => s.previewOpen);
  const setPreviewOpen = useMobileDrawerStore((s) => s.setPreviewOpen);
  const accountOpen = useMobileDrawerStore((s) => s.accountOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const [settingsDestination, setSettingsDestination] = useState<SettingsDestination | null>(null);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const drawerOpen = useMobileDrawerStore(selectDrawerOpen);
  const overlayDrawerOpen = useMobileDrawerStore(selectOverlayDrawerOpen);
  const hostSettingsOpen = useUIModalStore((s) => s.hostSettingsOpen);
  const closeHostSettings = useUIModalStore((s) => s.closeHostSettings);
  const openHostSettings = useUIModalStore((s) => s.openHostSettings);
  const [moreNav, setMoreNav] = useState({ path: state.location.pathname, open: false });
  if (moreNav.path !== state.location.pathname) {
    setMoreNav({ path: state.location.pathname, open: false });
  }
  const moreNavOpen = moreNav.path === state.location.pathname && moreNav.open;
  const { orgsError, membersError, integrationsError, refreshOrgs } = useOrgStore(
    useShallow((s) => ({
      orgsError: s.orgsError,
      membersError: s.membersError,
      integrationsError: s.integrationsError,
      refreshOrgs: s.refreshOrgs,
    })),
  );
  const { projectsError, refreshProjects } = useProjectsListStore(
    useShallow((s) => ({
      projectsError: s.projectsError,
      refreshProjects: s.refreshProjects,
    })),
  );
  const mobileNavActiveId: MobileNavId | null =
    state.mobileDestination === "agent"
    || state.mobileDestination === "execution"
    || state.mobileDestination === "tasks"
    || state.mobileDestination === "files"
      ? state.mobileDestination
      : state.mobileDestination === "process" || state.mobileDestination === "stats"
        ? "more"
        : null;
  const isMoreDestination = state.mobileDestination === "process" || state.mobileDestination === "stats";
  const showMoreNavMenu = moreNavOpen || isMoreDestination;

  useMobileDrawerEffects(Boolean(PreviewPanel));

  const handleMobilePrimaryNavigate = useCallback((id: MobileNavId) => {
    if (!state.mobileTargetProjectId) { navigate("/projects"); return; }
    if (id === "more") {
      setMoreNav((current) => ({ path: state.location.pathname, open: !current.open }));
      return;
    }
    setMoreNav((current) => ({ ...current, open: false }));
    if (id === "agent") { navigate(projectAgentsRoute(state.mobileTargetProjectId)); return; }
    if (id === "files") { navigate(projectFilesRoute(state.mobileTargetProjectId)); return; }
    if (id === "tasks") { navigate(projectTasksRoute(state.mobileTargetProjectId)); return; }
    navigate(projectWorkRoute(state.mobileTargetProjectId));
  }, [state.mobileTargetProjectId, state.location.pathname, navigate]);
  const handleMobileMoreNavigate = useCallback((id: MobileMoreNavId) => {
    if (!state.mobileTargetProjectId) return;
    setMoreNav((current) => ({ ...current, open: false }));
    if (id === "process") { navigate(projectProcessRoute(state.mobileTargetProjectId)); return; }
    navigate(projectStatsRoute(state.mobileTargetProjectId));
  }, [navigate, state.mobileTargetProjectId]);

  useEffect(() => {
    if (!navOpen && !moreNavOpen && !accountOpen && !previewOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (moreNavOpen) {
        setMoreNav((current) => ({ ...current, open: false }));
        return;
      }
      if (accountOpen) {
        if (settingsDestination) {
          setSettingsDestination(null);
          return;
        }
        blurActiveElement();
        setAccountOpen(false);
        return;
      }
      if (previewOpen) {
        blurActiveElement();
        setPreviewOpen(false);
        return;
      }
      if (navOpen) {
        closeDrawers();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accountOpen, closeDrawers, moreNavOpen, navOpen, previewOpen, setAccountOpen, setPreviewOpen, settingsDestination]);
  const connectionWarning = orgsError || projectsError || membersError || integrationsError;
  const retryWorkspaceLoad = useCallback(() => {
    void refreshOrgs();
    void refreshProjects();
  }, [refreshOrgs, refreshProjects]);
  const hostLabel = getHostDisplayLabel();

  return (
    <>
      <ActiveProvider>
        <div className={`${styles.mobileShell} ${overlayDrawerOpen ? styles.mobileShellDimmed : ""}`}>
          <MobileTopbar state={state} />
          <UpdateBanner />
          {connectionWarning ? (
            <div className={styles.mobileConnectionBanner} role="status" aria-live="polite">
              <div className={styles.mobileConnectionCopy}>
                <Text size="sm" weight="medium">Live workspace data could not load.</Text>
                <Text size="sm">
                  AURA is showing saved device data while it fails to reach {hostLabel}. Retry the load or update the host before trusting what you see here.
                </Text>
              </div>
              <div className={styles.mobileConnectionActions}>
                <Button variant="ghost" size="sm" onClick={() => void retryWorkspaceLoad()}>
                  Retry
                </Button>
                {features.hostRetargeting ? (
                  <Button variant="ghost" size="sm" onClick={openHostSettings}>
                    Host settings
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {!drawerOpen && state.showProjectTitle && !state.isProjectAgentManagementRoute && (
            <div className={styles.mobileProjectTabs}>
              <MobileBottomNav activeId={mobileNavActiveId} onNavigate={handleMobilePrimaryNavigate} />
              {showMoreNavMenu ? (
                <div className={styles.mobileMoreNavMenu} role="menu" aria-label="More project sections">
                  {MOBILE_MORE_NAV_ITEMS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={styles.mobileMoreNavItem}
                      data-active={state.mobileDestination === item.id ? "true" : "false"}
                      onClick={() => handleMobileMoreNavigate(item.id)}
                      role="menuitem"
                    >
                      <item.icon size={17} />
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}
          <div className={styles.mobileMain}>
            {state.showProjectResponsiveControls && ResponsiveControls && <div className={styles.mobileResponsiveControls}><ResponsiveControls /></div>}
            {state.isStandaloneAgentLibraryRoot ? (
              <div className={styles.mobileMainPanel}>
                <ErrorBoundary name="main">
                  <Suspense fallback={null}>
                    <MobileAgentLibraryView />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : state.isStandaloneAgentDetailRoute ? (
              <div className={styles.mobileMainPanel}>
                <ErrorBoundary name="main">
                  <Suspense fallback={null}>
                    <MobileAgentDetailsView />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : (
              <div className={styles.mobileMainPanel}>
                {/*
                  The persistent agent chat lives in `ConversationSurfaceHost`
                  (keyed by conversation lane) so switching Agents <-> Projects
                  on the same agent/session never remounts the chat. On a
                  conversation route the host paints the chat and the app
                  MainPanel's outlet is empty; on other routes the host hides
                  itself and the MainPanel renders the route content.
                */}
                <ErrorBoundary name="conversation"><ConversationSurfaceHost /></ErrorBoundary>
                {!conversationRoute.isConversationRoute && (
                  <ErrorBoundary name="main"><MainPanel>{routeContent}</MainPanel></ErrorBoundary>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          className={`${styles.mobileDrawerBackdrop} ${overlayDrawerOpen ? styles.mobileDrawerBackdropOpen : ""}`}
          aria-label="Close drawer"
          aria-hidden={!overlayDrawerOpen}
          tabIndex={overlayDrawerOpen ? 0 : -1}
          onClick={() => {
            setMoreNav((current) => ({ ...current, open: false }));
            closeDrawers();
          }}
        />

        <aside
          className={`${styles.mobileNavDrawer} ${navOpen ? styles.mobileNavDrawerOpen : ""}`}
          data-testid="project-navigation-drawer"
          aria-hidden={!navOpen}
          aria-label="Project navigation"
        >
          <ProjectNavigationDrawerContent />
        </aside>

        {PreviewPanel && state.isPhoneLayout && previewOpen ? (
          <div className={styles.mobilePreviewSheet} role="dialog" aria-modal="true" aria-label="Preview">
            <PreviewSheetContent PreviewPanel={PreviewPanel} PreviewHeader={PreviewHeaderComp} />
          </div>
        ) : null}

        {PreviewPanel && !state.isPhoneLayout && (
          <Drawer side="right" isOpen={previewOpen} onClose={() => { blurActiveElement(); setPreviewOpen(false); }} title="Preview" className={styles.mobileSideSheet} showMinimizedBar={false} defaultSize={360} maxSize={480}>
            <PreviewSheetContent PreviewPanel={PreviewPanel} PreviewHeader={PreviewHeaderComp} />
          </Drawer>
        )}

        {!state.isPhoneLayout ? (
          <Drawer side="right" isOpen={accountOpen} onClose={() => { blurActiveElement(); setAccountOpen(false); }} title="Account" className={styles.mobileSideSheet} showMinimizedBar={false} defaultSize={360} maxSize={440}>
            <AccountSheetContent />
          </Drawer>
        ) : null}

        {state.isPhoneLayout && accountOpen ? (
          <div className={styles.mobileActionSheet} role="dialog" aria-modal="true" aria-label="Settings">
            <div className={styles.mobileActionSheetHeader}>
              {settingsDestination ? (
                <button
                  type="button"
                  className={styles.mobileActionSheetBack}
                  aria-label="Back to Settings"
                  onClick={() => setSettingsDestination(null)}
                >
                  <ChevronLeft size={18} />
                  <span>Settings</span>
                </button>
              ) : (
                <div className={styles.mobileActionSheetTitle}>Settings</div>
              )}
              {settingsDestination ? (
                <div className={styles.mobileActionSheetDestinationTitle}>
                  {getSettingsDestinationTitle(settingsDestination)}
                </div>
              ) : null}
              <button
                type="button"
                className={styles.mobileActionSheetClose}
                aria-label="Close settings"
                onClick={() => {
                  blurActiveElement();
                  setSettingsDestination(null);
                  setAccountOpen(false);
                }}
              >
                <X size={18} />
              </button>
            </div>
            <AccountSheetContent
              mode="settings"
              settingsDestination={settingsDestination}
              onSettingsDestinationChange={setSettingsDestination}
            />
          </div>
        ) : null}

        {hostSettingsOpen ? (
          <Suspense fallback={null}>
            <HostSettingsModal
              isOpen={hostSettingsOpen}
              onClose={() => {
                blurActiveElement();
                closeHostSettings();
              }}
            />
          </Suspense>
        ) : null}
      </ActiveProvider>
    </>
  );
}
