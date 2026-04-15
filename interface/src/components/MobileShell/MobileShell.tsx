import { Fragment, Suspense, lazy, useCallback } from "react";
import { useNavigate, useOutlet } from "react-router-dom";
import { Drawer } from "@cypher-asi/zui";
import { ErrorBoundary } from "../ErrorBoundary";
import { RouteFallback } from "../RouteFallback/RouteFallback";
import { UpdateBanner } from "../UpdateBanner";
import { MobileBottomNav, type MobileNavId } from "../MobileBottomNav";
import { useMobileDrawerEffects } from "../../hooks/use-mobile-drawers";
import { useMobileDrawerStore, selectDrawerOpen, selectOverlayDrawerOpen } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { projectProcessRoute, projectStatsRoute, projectTasksRoute, projectWorkRoute } from "../../utils/mobileNavigation";
import { useMobileShellState } from "./useMobileShellState";
import { blurActiveElement, resolveProjectAgentPath } from "./mobile-shell-utils";
import { ProjectNavigationDrawerContent } from "./ProjectNavigationDrawer";
import { MobileTopbar } from "./MobileTopbar";
import { AppSwitcherContent, AccountSheetContent, PreviewSheetContent } from "./MobileDrawerContents";
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
  const mobileNavActiveId: MobileNavId | null = state.mobileDestination === "agent"
    || state.mobileDestination === "execution"
    || state.mobileDestination === "tasks"
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
    if (id === "process") { navigate(projectProcessRoute(state.mobileTargetProjectId)); return; }
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
              <div className={styles.mobileMainPanel}>
                <ErrorBoundary name="main">
                  <Suspense fallback={<RouteFallback />}>
                    <MobileAgentLibraryView />
                  </Suspense>
                </ErrorBoundary>
              </div>
            ) : state.isStandaloneAgentDetailRoute ? (
              <div className={styles.mobileMainPanel}>
                <ErrorBoundary name="main">
                  <Suspense fallback={<RouteFallback />}>
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

        <Drawer side="left" isOpen={navOpen} onClose={() => { blurActiveElement(); setNavOpen(false); }} title="Aura" className={styles.mobileNavDrawer} showMinimizedBar={false} defaultSize={356} maxSize={404}>
          {navOpen && <ProjectNavigationDrawerContent />}
        </Drawer>

        <Drawer side="right" isOpen={appOpen} onClose={() => { blurActiveElement(); setAppOpen(false); }} title="Navigate" className={styles.mobileSideSheet} showMinimizedBar={false} defaultSize={360} maxSize={420}>
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
