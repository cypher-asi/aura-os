import { useNavigate } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { ArrowLeft, ChevronDown, CircleUserRound, Menu, Plus } from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { projectAgentCreateRoute, projectRootPath } from "../../utils/mobileNavigation";
import type { MobileShellState } from "./useMobileShellState";
import styles from "./MobileShell.module.css";

export function MobileTopbar({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const setAppOpen = useMobileDrawerStore((s) => s.setAppOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const showStandaloneAgentLibraryCreate = state.isStandaloneAgentLibraryRoot;
  const showAccountAction =
    !state.isStandaloneAgentLibraryRoot
    && !state.isStandaloneAgentDetailRoute
    && !state.isMobileOrganizationRoute;

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
              icon={<ArrowLeft size={20} />}
              aria-label="Back to agent library"
              onClick={() => navigate("/agents")}
            />
          ) : state.showProjectBack && state.currentProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<ArrowLeft size={20} />}
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
              <Menu size={20} />
            </button>
          )}
        </div>
      }
      title={
        <span className={styles.mobileTopbarTitle}>
          {state.showProjectTitle ? (
            <button
              type="button"
              className={styles.mobileProjectTitleButton}
              onClick={() => setNavOpen(!navOpen)}
              aria-label={
                state.currentProject
                  ? `${navOpen ? "Close" : "Open"} project navigation for ${state.currentProject.name}`
                  : `${navOpen ? "Close" : "Open"} project navigation`
              }
            >
              <span className={styles.mobileTopbarTitleText}>{state.currentProject?.name ?? "Project"}</span>
              <ChevronDown size={16} />
            </button>
          ) : state.showGlobalTitle ? (
            <span className={styles.mobileTopbarTitleButton} aria-label={state.globalTitle}>
              <span className={styles.mobileTopbarTitleText}>{state.globalTitle}</span>
            </span>
          ) : (
            <span className={styles.mobileTopbarTitleButton} aria-label="Aura" style={{ userSelect: "none" }}>
              <img src="/AURA_logo_text_mark.png" alt="AURA" draggable={false} style={{ height: 11, display: "block", userSelect: "none", pointerEvents: "none" }} />
            </span>
          )}
        </span>
      }
      actions={
        <div className={styles.mobileTopbarActions}>
          {state.isProjectAgentChatRoute && state.currentProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Plus size={20} />}
              aria-label="Add or create project agent"
              onClick={() => navigate(projectAgentCreateRoute(state.currentProjectId!))}
            />
          ) : null}
          {showStandaloneAgentLibraryCreate ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Plus size={20} />}
              aria-label="Create Remote Agent"
              onClick={() => navigate("/agents?create=1")}
            />
          ) : null}
          {showAccountAction ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<CircleUserRound size={20} />}
              aria-label="Open account"
              onClick={() => {
                if (state.isPhoneLayout) {
                  navigate("/projects/organization");
                  return;
                }
                setAccountOpen(true);
              }}
            />
          ) : null}
        </div>
      }
    />
  );
}
