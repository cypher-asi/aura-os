import { Fragment, Suspense, lazy, useCallback } from "react";
import { useNavigate, useOutlet } from "react-router-dom";
import { Button, Drawer, Text } from "@cypher-asi/zui";
import { ErrorBoundary } from "../ErrorBoundary";
import { UpdateBanner } from "../UpdateBanner";
import { MobileBottomNav, type MobileNavId } from "../MobileBottomNav";
import { useMobileDrawerEffects } from "../../hooks/use-mobile-drawers";
import { useMobileDrawerStore, selectDrawerOpen, selectOverlayDrawerOpen } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { projectFilesRoute, projectProcessRoute, projectStatsRoute, projectTasksRoute, projectWorkRoute } from "../../utils/mobileNavigation";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { getHostDisplayLabel } from "../../shared/lib/host-config";
import { useMobileShellState } from "./useMobileShellState";
import { blurActiveElement, resolveProjectAgentPath } from "./mobile-shell-utils";
import { ProjectNavigationDrawerContent } from "./ProjectNavigationDrawer";
import { MobileTopbar } from "./MobileTopbar";
import { AppSwitcherContent, AccountSheetContent, PreviewSheetContent } from "./MobileDrawerContents";
import { useShallow } from "zustand/react/shallow";
import styles from "./MobileShell.module.css";

const HostSettingsModal = lazy(() =>
  import("../HostSettingsModal").then((module) => ({ default: module.HostSettingsModal })),
);
const MobileAgentLibraryView = lazy(() =>
  import("../../apps/agents/MobileAgentLibraryView").then((module) => ({
    default: module.MobileAgentLibraryView,
  })),
);
const MobileAgentDetailsView = lazy(() =>
  import("../../apps/agents/MobileAgentDetailsView").then((module) => ({
    default: module.MobileAgentDetailsView,
  })),
);

export function MobileShell() {
  const state = useMobileShellState();
  const routeContent = useOutlet();
  const navigate = useNavigate();
  const { features } = useAuraCapabilities();
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
  const hostSettingsOpen = useUIModalStore((s) => s.hostSettingsOpen);
  const closeHostSettings = useUIModalStore((s) => s.closeHostSettings);
  const openHostSettings = useUIModalStore((s) => s.openHostSettings);
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
  const mobileNavActiveId: MobileNavId | null = state.mobileDestination === "agent"
    || state.mobileDestination === "execution"
    || state.mobileDestination === "tasks"
    || state.mobileDestination === "files"
    || state.mobileDestination === "process"
    || state.mobileDestination === "stats"
    ? state.mobileDestination
    : null;

  useMobileDrawerEffects(Boolean(PreviewPanel));

  const handleMobilePrimaryNavigate = useCallback((id: MobileNavId) => {
    if (!state.mobileTargetProjectId) { navigate("/projects"); return; }
    if (id === "agent") { navigate(resolveProjectAgentPath(state.mobileTargetProjectId)); return; }
    if (id === "tasks") { navigate(projectTasksRoute(state.mobileTargetProjectId)); return; }
    if (id === "execution") { navigate(projectWorkRoute(state.mobileTargetProjectId)); return; }
    if (id === "files") { navigate(projectFilesRoute(state.mobileTargetProjectId)); return; }
    if (id === "process") { navigate(projectProcessRoute(state.mobileTargetProjectId)); return; }
    navigate(projectStatsRoute(state.mobileTargetProjectId));
  }, [state.mobileTargetProjectId, navigate]);
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
                  Aura is showing saved device data while it fails to reach {hostLabel}. Retry the load or update the host before trusting what you see here.
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
              <div className={styles.mobileMainPanel}><ErrorBoundary name="main"><MainPanel>{routeContent}</MainPanel></ErrorBoundary></div>
            )}
          </div>
          {!drawerOpen && state.showProjectTitle && !state.isProjectAgentManagementRoute && (
            <div className={styles.mobileBottomNav}>
              <MobileBottomNav activeId={mobileNavActiveId} onNavigate={handleMobilePrimaryNavigate} />
            </div>
          )}
        </div>
        {overlayDrawerOpen && <button type="button" className={styles.mobileDrawerBackdrop} aria-label="Close drawer" onClick={closeDrawers} />}

        <Drawer side="left" isOpen={navOpen} onClose={() => { blurActiveElement(); setNavOpen(false); }} title="" className={styles.mobileNavDrawer} showMinimizedBar={false} defaultSize={356} maxSize={404}>
          {navOpen && <ProjectNavigationDrawerContent />}
        </Drawer>

        <Drawer side="right" isOpen={appOpen} onClose={() => { blurActiveElement(); setAppOpen(false); }} title="Navigate" className={styles.mobileSideSheet} showMinimizedBar={false} defaultSize={360} maxSize={420}>
          <AppSwitcherContent state={state} />
        </Drawer>

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
