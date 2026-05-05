import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Circle,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  LayoutGrid,
  Settings,
} from "lucide-react";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useActiveApp } from "../../hooks/use-active-app";
import { useAppUIStore } from "../../stores/app-ui-store";
import { getTaskbarAppsCollapsed, setTaskbarAppsCollapsed } from "../../utils/storage";
import { formatCredits } from "../../shared/utils/format";
import { AppNavRail, TaskbarIconButton, TASKBAR_ICON_SIZE } from "../AppNavRail";
import { useCreditBalance } from "../CreditsBadge/useCreditBalance";
import { useDesktopContextMenu } from "../DesktopContextMenu";
import { FavoriteAgentsStrip } from "./FavoriteAgentsStrip";
import { HelpButton } from "../../features/onboarding/HelpButton/HelpButton";
import styles from "./BottomTaskbar.module.css";

const TASKBAR_CHEVRON_SIZE = TASKBAR_ICON_SIZE + 1;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function BottomTaskbar() {
  const openBuyCredits = useUIModalStore((s) => s.openBuyCredits);
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openAppsModal = useUIModalStore((s) => s.openAppsModal);
  const activeApp = useActiveApp();
  const time = useClock();
  const navigate = useNavigate();
  const previousPath = useAppUIStore((s) => s.previousPath);
  const { credits } = useCreditBalance();
  const [collapsed, setCollapsed] = useState(() => getTaskbarAppsCollapsed());
  const [creditsExpanded, setCreditsExpanded] = useState(false);
  const creditsLabel = credits !== null ? formatCredits(credits) : "---";
  const { handleContextMenu, menuElement } = useDesktopContextMenu();

  const toggleAppsCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      setTaskbarAppsCollapsed(next);
      return next;
    });
  };

  // Only open the desktop context menu when the right-click lands on empty
  // taskbar chrome — clicks on icons/buttons keep their own behavior (or the
  // browser default for items without a custom handler).
  const onContextMenu = (event: React.MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, [role="menuitem"], [role="menu"]')) {
      return;
    }
    handleContextMenu(event);
  };

  return (
    <div
      className={styles.bar}
      data-agent-surface="desktop-shell-bottom-taskbar"
      data-agent-proof="desktop-shell-bottom-taskbar"
      data-agent-context-anchor="desktop-shell-bottom-taskbar"
      onContextMenu={onContextMenu}
    >
      <div className={styles.left}>
        <TaskbarIconButton
          selected={activeApp.id === "desktop"}
          icon={<Circle size={TASKBAR_ICON_SIZE} />}
          title="Desktop"
          aria-label="Desktop"
          onClick={() => {
            if (activeApp.id === "desktop") {
              if (previousPath) navigate(previousPath);
            } else {
              navigate("/desktop");
            }
          }}
        />
        <FavoriteAgentsStrip />
      </div>

      <div className={styles.center}>
        <AppNavRail
          layout="taskbar"
          allowReorder
          excludeIds={["profile"]}
          {...(collapsed && { includeIds: ["agents", "projects"] })}
        />
        <TaskbarIconButton
          icon={<LayoutGrid size={TASKBAR_ICON_SIZE} />}
          title="Apps"
          aria-label="Apps"
          onClick={openAppsModal}
        />
        <TaskbarIconButton
          icon={
            collapsed ? (
              <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
            ) : (
              <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
            )
          }
          onClick={toggleAppsCollapsed}
          aria-label={collapsed ? "Expand apps" : "Collapse apps"}
        />
      </div>

      <div className={styles.right}>
        <div className={styles.rightPrimary}>
          <TaskbarIconButton
            icon={
              creditsExpanded ? (
                <ChevronRight size={TASKBAR_CHEVRON_SIZE} />
              ) : (
                <ChevronLeft size={TASKBAR_CHEVRON_SIZE} />
              )
            }
            onClick={() => setCreditsExpanded((current) => !current)}
            aria-label={creditsExpanded ? "Hide credits balance" : "Show credits balance"}
          />
          {creditsExpanded ? (
            <span className={styles.creditsSummary} aria-live="polite">
              {creditsLabel}
            </span>
          ) : null}
          <TaskbarIconButton
            icon={<CreditCard size={TASKBAR_ICON_SIZE} />}
            title="Credits"
            aria-label="Credits"
            onClick={openBuyCredits}
          />
          <TaskbarIconButton
            icon={<Settings size={TASKBAR_ICON_SIZE} />}
            title="Settings"
            aria-label="Settings"
            onClick={openOrgSettings}
          />
          <HelpButton />
          <AppNavRail
            layout="taskbar"
            includeIds={["profile"]}
            ariaLabel="Profile shortcut"
          />
        </div>
        <span className={styles.clock}>{time}</span>
      </div>
      {menuElement}
    </div>
  );
}
