import { useNavigate } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { ArrowLeft, ChevronDown, CircleUserRound, Menu } from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { projectRootPath } from "../../utils/mobileNavigation";
import type { MobileShellState } from "./useMobileShellState";
import styles from "./MobileShell.module.css";

export function MobileTopbar({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const setAppOpen = useMobileDrawerStore((s) => s.setAppOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);

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
              icon={<ArrowLeft size={18} />}
              aria-label="Back to agent library"
              onClick={() => navigate("/agents")}
            />
          ) : state.showProjectBack && state.currentProjectId ? (
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<ArrowLeft size={18} />}
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
              <Menu size={18} />
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
              onClick={() => setNavOpen(true)}
              aria-label={state.currentProject ? `Open project navigation for ${state.currentProject.name}` : "Open project navigation"}
            >
              <span className={styles.mobileTopbarTitleText}>{state.currentProject?.name ?? "Project"}</span>
              <ChevronDown size={14} />
            </button>
          ) : state.showGlobalTitle ? (
            <span className={styles.mobileTopbarTitleButton} aria-label={state.globalTitle}>
              <span className={styles.mobileTopbarTitleText}>{state.globalTitle}</span>
            </span>
          ) : (
            <span className={styles.mobileTopbarTitleButton} aria-label="Aura">
              <img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} />
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
