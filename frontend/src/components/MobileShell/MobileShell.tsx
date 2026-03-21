import { useCallback } from "react";
import { useNavigate, useOutlet } from "react-router-dom";
import { Topbar, Drawer, Button, ButtonPlus } from "@cypher-asi/zui";
import { ErrorBoundary } from "../ErrorBoundary";
import {
  ArrowLeft, ChevronDown, CircleUserRound,
  Settings, Trophy, Building2,
} from "lucide-react";
import { PanelSearch } from "../PanelSearch";
import { ProjectList } from "../ProjectList";
import { UpdateBanner } from "../UpdateBanner";
import { MobileBottomNav, type MobileNavId } from "../MobileBottomNav";
import { useSidebarSearch } from "../../context/SidebarSearchContext";
import { useMobileDrawerEffects } from "../../hooks/use-mobile-drawers";
import { useMobileDrawerStore, selectDrawerOpen, selectOverlayDrawerOpen } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useProjectsList } from "../../apps/projects/useProjectsList";
import { projectAgentRoute, projectFilesRoute, projectRootPath, projectWorkRoute } from "../../utils/mobileNavigation";
import { useMobileShellState } from "./useMobileShellState";
import styles from "../AppShell/AppShell.module.css";

function blurActiveElement() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

function ProjectNavigationDrawerContent() {
  const { query, setQuery } = useSidebarSearch();
  const { openNewProjectModal } = useProjectsList();
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerSearch}>
        <PanelSearch placeholder="" value={query} onChange={setQuery} action={<ButtonPlus onClick={openNewProjectModal} size="sm" title="New Project" />} />
      </div>
      <div className={styles.mobileDrawerBody}><ProjectList /></div>
    </div>
  );
}

function AccountSheetContent() {
  const navigate = useNavigate();
  const { openAfterDrawerClose } = useMobileDrawerStore();
  const { openOrgSettings, openSettings } = useUIModalStore();
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileDrawerActions}>
          <Button variant="ghost" size="sm" icon={<CircleUserRound size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(() => navigate("/profile"))}>Profile</Button>
          <Button variant="ghost" size="sm" icon={<Trophy size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(() => navigate("/leaderboard"))}>Leaderboard</Button>
          <Button variant="ghost" size="sm" icon={<Building2 size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openOrgSettings)}>Team settings</Button>
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
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);

  return (
    <Topbar
      className={styles.mobileTopbar}
      icon={
        <div className={styles.mobileTopbarSlot}>
          {state.showProjectBack && state.currentProjectId ? (
            <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={18} />} aria-label="Back to project" onClick={() => navigate(projectRootPath(state.currentProjectId!))} />
          ) : null}
        </div>
      }
      title={
        <span className={styles.mobileTopbarTitle}>
          {state.showProjectTitle ? (
            <button type="button" className={styles.mobileProjectTitleButton} onClick={() => setNavOpen(true)} aria-label={state.currentProject ? `Open project navigation for ${state.currentProject.name}` : "Open project navigation"}>
              <span className={styles.mobileTopbarTitleText}>{state.currentProject?.name ?? "Project"}</span>
              <ChevronDown size={14} />
            </button>
          ) : state.mobileTargetProject ? (
            <button type="button" className={styles.mobileProjectTitleButton} onClick={() => setNavOpen(true)} aria-label={`Open project navigation for ${state.mobileTargetProject.name}`}>
              <span className={styles.mobileTopbarTitleText}>{state.mobileTargetProject.name}</span>
              <ChevronDown size={14} />
            </button>
          ) : (
            <span className={styles.mobileTopbarTitleButton} aria-label="Aura">
              <span className={styles.mobileTopbarTitleText}>AURA</span>
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

  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const previewOpen = useMobileDrawerStore((s) => s.previewOpen);
  const setPreviewOpen = useMobileDrawerStore((s) => s.setPreviewOpen);
  const accountOpen = useMobileDrawerStore((s) => s.accountOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const drawerOpen = useMobileDrawerStore(selectDrawerOpen);
  const overlayDrawerOpen = useMobileDrawerStore(selectOverlayDrawerOpen);

  useMobileDrawerEffects(Boolean(PreviewPanel));

  const handleMobilePrimaryNavigate = useCallback((id: MobileNavId) => {
    if (id === "feed") { navigate("/feed"); return; }
    if (!state.mobileTargetProjectId) { navigate("/projects"); return; }
    if (id === "agent") { navigate(projectAgentRoute(state.mobileTargetProjectId)); return; }
    if (id === "tasks") { navigate(projectWorkRoute(state.mobileTargetProjectId)); return; }
    navigate(projectFilesRoute(state.mobileTargetProjectId));
  }, [state.mobileTargetProjectId, navigate]);

  return (
    <>
      <div className={`${styles.mobileShell} ${overlayDrawerOpen ? styles.mobileShellDimmed : ""}`}>
        <MobileTopbar state={state} />
        <UpdateBanner />
        <div className={styles.mobileMain}>
          {state.showProjectResponsiveControls && ResponsiveControls && <div className={styles.mobileResponsiveControls}><ResponsiveControls /></div>}
          <div className={styles.mobileMainPanel}><ErrorBoundary name="main"><MainPanel>{routeContent}</MainPanel></ErrorBoundary></div>
        </div>
        {!drawerOpen && <div className={styles.mobileBottomNav}><MobileBottomNav activeId={state.mobileDestination} onNavigate={handleMobilePrimaryNavigate} /></div>}
      </div>

      {overlayDrawerOpen && <button type="button" className={styles.mobileDrawerBackdrop} aria-label="Close drawer" onClick={closeDrawers} />}

      <Drawer side="left" isOpen={navOpen} onClose={() => { blurActiveElement(); setNavOpen(false); }} title="Aura" className={styles.mobileNavDrawer} showMinimizedBar={false} defaultSize={356} maxSize={404}>
        {navOpen && <ProjectNavigationDrawerContent />}
      </Drawer>

      {PreviewPanel && (
        <Drawer side={state.isPhoneLayout ? "bottom" : "right"} isOpen={previewOpen} onClose={() => { blurActiveElement(); setPreviewOpen(false); }} title="Preview" className={state.isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet} showMinimizedBar={false} defaultSize={state.isPhoneLayout ? 420 : 360} maxSize={state.isPhoneLayout ? 640 : 480}>
          <PreviewSheetContent PreviewPanel={PreviewPanel} PreviewHeader={PreviewHeaderComp} />
        </Drawer>
      )}

      <Drawer side={state.isPhoneLayout ? "bottom" : "right"} isOpen={accountOpen} onClose={() => { blurActiveElement(); setAccountOpen(false); }} title="Account" className={state.isPhoneLayout ? styles.mobileSheetDrawer : styles.mobileSideSheet} showMinimizedBar={false} defaultSize={state.isPhoneLayout ? 320 : 360} maxSize={state.isPhoneLayout ? 420 : 440}>
        <AccountSheetContent />
      </Drawer>
    </>
  );
}
