import { useNavigate } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { ArrowLeft, CircleUserRound, Menu, Plus, Settings } from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { projectAgentsRoute, projectRootPath, projectWorkRoute } from "../../utils/mobileNavigation";
import { MobileThemeToggleButton } from "../components/MobileThemeToggleButton";
import type { MobileShellState } from "./useMobileShellState";
import {
  buildMobileReturnState,
  resolveGlobalReturnPath,
  resolveSettingsReturnPath,
  resolveWorkspaceReturnPath,
} from "./mobile-shell-utils";
import styles from "./MobileShell.module.css";

export function MobileTopbar({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const showStandaloneAgentLibraryCreate = state.isMobileClient && state.isStandaloneAgentLibraryRoot;
  const moreReturnTo = (() => {
    const locationState = state.location.state;
    if (
      state.currentProjectId
      && locationState
      && typeof locationState === "object"
      && "moreReturnTo" in locationState
    ) {
      const candidate = (locationState as { moreReturnTo?: unknown }).moreReturnTo;
      if (typeof candidate === "string" && candidate.startsWith(`/projects/${state.currentProjectId}/`)) {
        return candidate;
      }
    }
    return state.currentProjectId ? projectWorkRoute(state.currentProjectId) : "/projects";
  })();

  return (
      <Topbar
        className={styles.mobileTopbar}
        icon={
          <div className={styles.mobileTopbarSlot}>
            {state.isProjectAgentChatRoute && state.currentProjectId ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to agents"
                onClick={() => navigate(projectAgentsRoute(state.currentProjectId!))}
              />
            ) : state.isMoreDetailRoute && state.currentProjectId ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to More"
                onClick={() => navigate(moreReturnTo, { state: { openMoreNav: true } })}
              />
            ) : state.isStandaloneAgentDetailRoute ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to agent library"
                onClick={() => navigate("/agents")}
              />
            ) : state.isMobileOrganizationRoute && state.mobileTargetProjectId ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to project"
                onClick={() => navigate(resolveWorkspaceReturnPath(state.mobileTargetProjectId, state.location.state))}
              />
            ) : state.location.pathname.startsWith("/projects/settings/") ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to settings"
                onClick={() => navigate("/projects/settings", { state: state.location.state })}
              />
            ) : state.location.pathname === "/projects/settings" ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to previous screen"
                onClick={() => navigate(resolveSettingsReturnPath(state.mobileTargetProjectId, state.location.state))}
              />
            ) : state.location.pathname === "/profile" || state.location.pathname.startsWith("/profile/") ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<ArrowLeft size={20} />}
                aria-label="Back to previous screen"
                onClick={() => navigate(resolveGlobalReturnPath(state.mobileTargetProjectId, state.location.state))}
              />
            ) : state.showProjectBack && state.currentProjectId ? (
              <Button
                className={styles.mobileTopbarIconButton}
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
                <img src="/AURA_logo_text_mark.png" alt="AURA" draggable={false} data-aura-wordmark />
              </span>
            )}
          </span>
        }
        actions={
          <div className={styles.mobileTopbarActions}>
            {showStandaloneAgentLibraryCreate ? (
              <Button
                className={styles.mobileTopbarIconButton}
                variant="ghost"
                size="sm"
                iconOnly
                icon={<Plus size={20} />}
                aria-label="Create Remote Agent"
                onClick={() => navigate("/agents?create=1")}
              />
            ) : null}
            <MobileThemeToggleButton />
            <Button
              className={styles.mobileTopbarIconButton}
              variant="ghost"
              size="sm"
              iconOnly
              icon={<CircleUserRound size={19} />}
              aria-label="Open profile"
              onClick={() => navigate("/profile", { state: buildMobileReturnState(state.location.pathname) })}
            />
            <Button
              className={styles.mobileTopbarIconButton}
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Settings size={19} />}
              aria-label="Open settings"
              onClick={() => {
                const returnTo = state.location.pathname.startsWith("/projects/settings")
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
