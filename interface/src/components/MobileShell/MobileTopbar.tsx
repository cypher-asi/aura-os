import { useNavigate } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { ArrowLeft, CircleUserRound, Menu, Plus, Settings } from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { projectRootPath } from "../../utils/mobileNavigation";
import type { MobileShellState } from "./useMobileShellState";
import { resolveSettingsReturnPath, resolveWorkspaceReturnPath } from "./mobile-shell-utils";
import styles from "./MobileShell.module.css";

export function MobileTopbar({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const showStandaloneAgentLibraryCreate = state.isMobileClient && state.isStandaloneAgentLibraryRoot;

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
            ) : state.isMobileOrganizationRoute && state.mobileTargetProjectId ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to project"
                onClick={() => navigate(resolveWorkspaceReturnPath(state.mobileTargetProjectId, state.location.state))}
              />
            ) : state.location.pathname === "/projects/settings" ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to previous screen"
                onClick={() => navigate(resolveSettingsReturnPath(state.mobileTargetProjectId, state.location.state))}
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
                aria-label="Open project navigation"
                onClick={() => setNavOpen(!navOpen)}
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
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<CircleUserRound size={19} />}
              aria-label="Open profile"
              onClick={() => navigate("/profile")}
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Settings size={19} />}
              aria-label="Open settings"
              onClick={() => {
                const returnTo = state.location.pathname === "/projects/settings"
                  ? resolveSettingsReturnPath(state.mobileTargetProjectId, state.location.state)
                  : state.location.pathname;
                navigate("/projects/settings", { state: { returnTo } });
              }}
            />
          </div>
        }
      />
  );
}
