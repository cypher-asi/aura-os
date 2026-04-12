import { useNavigate } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import {
  CircleUserRound, Settings, Building2, Server,
  FolderOpen, Bot, GitCommitVertical,
} from "lucide-react";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { projectWorkRoute, projectStatsRoute, projectTasksRoute, projectProcessRoute } from "../../utils/mobileNavigation";
import { resolveProjectAgentPath } from "./mobile-shell-utils";
import type { MobileShellState } from "./useMobileShellState";
import styles from "./MobileShell.module.css";

function resolveGlobalProjectPath(state: MobileShellState) {
  if (state.mobileDestination === "tasks" && state.mobileTargetProjectId) {
    return projectTasksRoute(state.mobileTargetProjectId);
  }

  if (state.mobileDestination === "execution" && state.mobileTargetProjectId) {
    return projectWorkRoute(state.mobileTargetProjectId);
  }

  if (state.mobileDestination === "process" && state.mobileTargetProjectId) {
    return projectProcessRoute(state.mobileTargetProjectId);
  }

  if (state.mobileDestination === "stats" && state.mobileTargetProjectId) {
    return projectStatsRoute(state.mobileTargetProjectId);
  }

  if (state.mobileTargetProjectId) {
    return resolveProjectAgentPath(state.mobileTargetProjectId);
  }

  return "/projects";
}

function resolveGlobalAgentsPath() {
  return "/agents";
}

export function AppSwitcherContent({ state }: { state: MobileShellState }) {
  const navigate = useNavigate();
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const setAccountOpen = useMobileDrawerStore((s) => s.setAccountOpen);
  const activeAppId = state.activeApp.id;
  const projectLauncherLabel = state.mobileTargetProject ? "Return to project" : "Projects";
  const projectLauncherDescription = state.mobileTargetProject?.name ?? "Open your projects";

  const items = [
    {
      id: "projects",
      label: projectLauncherLabel,
      description: projectLauncherDescription,
      icon: FolderOpen,
      path: resolveGlobalProjectPath(state),
    },
    {
      id: "agents",
      label: "Agent library",
      description: "Browse shared agents",
      icon: Bot,
      path: resolveGlobalAgentsPath(),
    },
    {
      id: "feed",
      label: "Feed",
      description: "Activity across your projects",
      icon: GitCommitVertical,
      path: "/feed",
    },
    {
      id: "profile",
      label: "Profile",
      description: "Your account and activity",
      icon: CircleUserRound,
      path: "/profile",
    },
    {
      id: "account",
      label: "Account settings",
      description: "Team, host, and app settings",
      icon: Settings,
      onSelect: () => setAccountOpen(true),
    },
  ] as const;

  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileAppSwitcherList}>
          {items.map((item) => {
            const isSelected = item.id === "projects"
              ? activeAppId === "projects"
              : activeAppId === item.id;

            return (
              <button
                key={item.id}
                type="button"
                className={`${styles.mobileAppSwitcherButton} ${isSelected ? styles.mobileAppSwitcherButtonActive : ""}`}
                aria-pressed={isSelected}
                aria-label={item.label}
                onClick={() => openAfterDrawerClose(() => {
                  if ("path" in item) {
                    navigate(item.path);
                    return;
                  }
                  item.onSelect();
                })}
              >
                <span className={styles.mobileAppSwitcherIcon}>
                  <item.icon size={18} />
                </span>
                <span className={styles.mobileAppSwitcherText}>
                  <span className={styles.mobileAppSwitcherLabel}>{item.label}</span>
                  <span className={styles.mobileAppSwitcherDescription}>{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function AccountSheetContent() {
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const { features } = useAuraCapabilities();
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openSettings = useUIModalStore((s) => s.openSettings);
  const openHostSettings = useUIModalStore((s) => s.openHostSettings);
  return (
    <div className={styles.mobileDrawerContent}>
      <div className={styles.mobileDrawerBody}>
        <div className={styles.mobileDrawerActions}>
          <Button variant="ghost" size="sm" icon={<Building2 size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openOrgSettings)}>Team settings</Button>
          {features.hostRetargeting ? (
            <Button variant="ghost" size="sm" icon={<Server size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openHostSettings)}>Host settings</Button>
          ) : null}
          <Button variant="ghost" size="sm" icon={<Settings size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openSettings)}>App settings</Button>
        </div>
      </div>
    </div>
  );
}

export function PreviewSheetContent({ PreviewPanel, PreviewHeader }: { PreviewPanel: React.ComponentType; PreviewHeader?: React.ComponentType }) {
  return (
    <div className={styles.mobileDrawerContent}>
      {PreviewHeader && <div className={styles.mobileContextHeader}><PreviewHeader /></div>}
      <div className={styles.mobileDrawerBody}><PreviewPanel /></div>
    </div>
  );
}
