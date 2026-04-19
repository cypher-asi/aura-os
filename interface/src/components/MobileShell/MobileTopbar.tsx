import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Topbar, Button } from "@cypher-asi/zui";
import { ArrowLeft, ChevronDown, Link2, Menu, Plus, Settings2, Sparkles, X } from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { projectAgentAttachRoute, projectAgentCreateRoute, projectRootPath } from "../../utils/mobileNavigation";
import type { MobileShellState } from "./useMobileShellState";
import { resolveWorkspaceReturnPath } from "./mobile-shell-utils";
import styles from "./MobileShell.module.css";

export function MobileTopbar({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const [projectAgentActionsOpen, setProjectAgentActionsOpen] = useState(false);
  const [pendingProjectAgentRoute, setPendingProjectAgentRoute] = useState<string | null>(null);
  const navOpen = useMobileDrawerStore((s) => s.navOpen);
  const setNavOpen = useMobileDrawerStore((s) => s.setNavOpen);
  const setAppOpen = useMobileDrawerStore((s) => s.setAppOpen);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const showStandaloneAgentLibraryCreate = state.isMobileClient && state.isStandaloneAgentLibraryRoot;
  const showAccountAction =
    !state.isStandaloneAgentLibraryRoot
    && !state.isStandaloneAgentDetailRoute
    && !state.isMobileOrganizationRoute;

  useEffect(() => {
    if (projectAgentActionsOpen || !pendingProjectAgentRoute) {
      return;
    }

    const route = pendingProjectAgentRoute;
    const timer = window.setTimeout(() => {
      navigate(route);
      setPendingProjectAgentRoute(null);
    }, 160);

    return () => window.clearTimeout(timer);
  }, [navigate, pendingProjectAgentRoute, projectAgentActionsOpen]);

  return (
    <>
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
            {state.isMobileClient && state.isProjectAgentChatRoute && state.currentProjectId ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                icon={<Plus size={20} />}
                aria-label="Add project agent"
                onClick={() => setProjectAgentActionsOpen(true)}
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
                icon={<Settings2 size={20} />}
                aria-label="Open workspace"
                onClick={() => {
                  if (state.isPhoneLayout) {
                    navigate("/projects/organization", {
                      state: state.currentProjectId
                        ? { returnTo: state.location.pathname }
                        : undefined,
                    });
                    return;
                  }
                  setAccountOpen(true);
                }}
              />
            ) : null}
          </div>
        }
      />
      {projectAgentActionsOpen ? (
        <>
          <button
            type="button"
            className={styles.mobileDrawerBackdrop}
            aria-label="Close add project agent sheet"
            onClick={() => setProjectAgentActionsOpen(false)}
          />
          <div
            className={styles.mobileActionSheet}
            role="dialog"
            aria-modal="true"
            aria-label="Add Project Agent"
          >
            <div className={styles.mobileActionSheetHeader}>
              <span className={styles.mobileActionSheetTitle}>Add Project Agent</span>
              <button
                type="button"
                className={styles.mobileActionSheetClose}
                aria-label="Close add project agent sheet"
                onClick={() => setProjectAgentActionsOpen(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className={styles.mobileDrawerContent}>
              <div className={styles.mobileDrawerBody}>
                <div className={styles.mobileAppSwitcherList}>
                  <button
                    type="button"
                    className={styles.mobileAppSwitcherButton}
                    onClick={() => {
                      if (!state.currentProjectId) return;
                      setPendingProjectAgentRoute(projectAgentCreateRoute(state.currentProjectId));
                      setProjectAgentActionsOpen(false);
                    }}
                  >
                    <span className={styles.mobileAppSwitcherIcon}>
                      <Sparkles size={18} />
                    </span>
                    <span className={styles.mobileAppSwitcherText}>
                      <span className={styles.mobileAppSwitcherLabel}>Create Remote Agent</span>
                      <span className={styles.mobileAppSwitcherDescription}>
                        Start a fresh Aura-managed agent for this project.
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.mobileAppSwitcherButton}
                    onClick={() => {
                      if (!state.currentProjectId) return;
                      setPendingProjectAgentRoute(projectAgentAttachRoute(state.currentProjectId));
                      setProjectAgentActionsOpen(false);
                    }}
                  >
                    <span className={styles.mobileAppSwitcherIcon}>
                      <Link2 size={18} />
                    </span>
                    <span className={styles.mobileAppSwitcherText}>
                      <span className={styles.mobileAppSwitcherLabel}>Attach Existing Agent</span>
                      <span className={styles.mobileAppSwitcherDescription}>
                        Reuse a shared remote agent that already exists in your org.
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
