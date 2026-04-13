import { useCallback, useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type ButtonHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@cypher-asi/zui";
import type { AuraApp } from "../../apps/types";
import { getOrderedTaskbarApps, useAppStore } from "../../stores/app-store";
import { getLastSelectedAgentId } from "../../apps/agents/stores";
import { getLastProject, getLastAgent } from "../../utils/storage";
import { LAST_PROCESS_ID_KEY } from "../../apps/process/stores/process-store";
import styles from "./AppNavRail.module.css";

export const TASKBAR_ICON_SIZE = 15;

function resolveAppPath(app: { id: string; basePath: string }): string {
  if (app.id === "agents") {
    const lastId = getLastSelectedAgentId();
    if (lastId) return `/agents/${lastId}`;
  }
  if (app.id === "projects") {
    const projectId = getLastProject();
    if (projectId) {
      const agentInstanceId = getLastAgent(projectId);
      if (agentInstanceId) return `/projects/${projectId}/agents/${agentInstanceId}`;
      return `/projects/${projectId}/agent`;
    }
  }
  if (app.id === "tasks") {
    const projectId = getLastProject();
    if (projectId) return `/tasks/${projectId}`;
  }
  if (app.id === "process") {
    const lastId = localStorage.getItem(LAST_PROCESS_ID_KEY);
    if (lastId) return `/process/${lastId}`;
  }
  return app.basePath;
}

interface NavRailButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label?: string;
  selected?: boolean;
}

function NavRailButton({ icon, label, selected, className, ...props }: NavRailButtonProps) {
  const cls = [
    styles.navBtn,
    selected ? styles.navBtnSelected : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type="button" className={cls} {...props}>
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

export function TaskbarIconButton({
  icon,
  selected = false,
  className,
  ...props
}: Omit<NavRailButtonProps, "label">) {
  const cls = [styles.taskbarBtn, className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      iconOnly
      icon={icon}
      selected={selected}
      aria-pressed={selected}
      className={cls}
      {...props}
    />
  );
}

type AppNavItem = Pick<AuraApp, "id" | "label" | "basePath" | "icon" | "onPrefetch">;

interface SortableTaskbarAppButtonProps {
  app: AppNavItem;
  selected: boolean;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, appId: string) => void;
}

function SortableTaskbarAppButton({
  app,
  selected,
  onClick,
  onPointerDown,
}: SortableTaskbarAppButtonProps) {
  return (
    <button
      type="button"
      className={styles.taskbarBtn}
      data-selected={selected}
      data-taskbar-app-id={app.id}
      title={app.label}
      aria-label={app.label}
      onClick={onClick}
      onPointerDown={(event) => onPointerDown(event, app.id)}
      onMouseEnter={app.onPrefetch}
      onFocus={app.onPrefetch}
    >
      <app.icon size={TASKBAR_ICON_SIZE} />
    </button>
  );
}

interface AppNavRailProps {
  layout?: "rail" | "bar" | "taskbar";
  includeIds?: string[];
  excludeIds?: string[];
  ariaLabel?: string;
  allowReorder?: boolean;
}

export function AppNavRail({
  layout = "rail",
  includeIds,
  excludeIds = [],
  ariaLabel = "Primary navigation",
  allowReorder = false,
}: AppNavRailProps) {
  const apps = useAppStore((s) => s.apps);
  const activeApp = useAppStore((s) => s.activeApp);
  const taskbarAppOrder = useAppStore((s) => s.taskbarAppOrder);
  const reorderTaskbarApps = useAppStore((s) => s.reorderTaskbarApps);
  const navigate = useNavigate();
  const includeSet = includeIds ? new Set(includeIds) : null;
  const excludeSet = new Set(excludeIds);
  const orderedApps = useMemo(
    () => (layout === "taskbar" ? getOrderedTaskbarApps(apps, taskbarAppOrder) : apps),
    [apps, layout, taskbarAppOrder],
  );
  const primaryApps = orderedApps.filter((app) => {
    if (app.id === "desktop") return false;
    if (excludeSet.has(app.id)) return false;
    if (includeSet && !includeSet.has(app.id)) return false;
    return true;
  });
  const isRail = layout === "rail";
  const isBar = layout === "bar";
  const handleAppClick = useCallback(
    (app: { id: string; basePath: string }) => navigate(resolveAppPath(app)),
    [navigate],
  );
  const canReorder = layout === "taskbar" && allowReorder && primaryApps.length > 1;
  const suppressClickRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      dragCleanupRef.current?.();
    },
    [],
  );
  const handleTaskbarAppClick = useCallback(
    (app: { id: string; basePath: string }) => {
      if (suppressClickRef.current === app.id) {
        suppressClickRef.current = null;
        return;
      }
      suppressClickRef.current = null;
      handleAppClick(app);
    },
    [handleAppClick],
  );
  const handleTaskbarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, appId: string) => {
      if (!canReorder || event.button !== 0) return;

      suppressClickRef.current = null;
      dragCleanupRef.current?.();

      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let lastOverId: string | null = null;

      if (typeof target.setPointerCapture === "function") {
        target.setPointerCapture(pointerId);
      }

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
        if (
          typeof target.releasePointerCapture === "function" &&
          typeof target.hasPointerCapture === "function" &&
          target.hasPointerCapture(pointerId)
        ) {
          target.releasePointerCapture(pointerId);
        }
        dragCleanupRef.current = null;
      };

      const handlePointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) return;

        if (!dragging) {
          const distance = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
          if (distance < 6) return;
          dragging = true;
        }

        moveEvent.preventDefault();

        const overElement = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
        const overButton =
          overElement instanceof HTMLElement
            ? overElement.closest<HTMLElement>("[data-taskbar-app-id]")
            : null;
        const overId = overButton?.dataset.taskbarAppId;

        if (!overId || overId === appId || overId === lastOverId) return;

        lastOverId = overId;
        reorderTaskbarApps(appId, overId);
      };

      const handlePointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;

        cleanup();
        if (dragging) suppressClickRef.current = appId;
      };

      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
    },
    [canReorder, reorderTaskbarApps],
  );

  return (
    <nav
      className={isRail ? styles.rail : isBar ? styles.bar : styles.taskbar}
      aria-label={ariaLabel}
    >
      {isRail ? (
        <>
          <div className={styles.spacer} />
          <div className={styles.floatingGroupMiddle}>
            <div className={styles.appGroup}>
              {primaryApps.map((app) => (
                <NavRailButton
                  key={app.id}
                  icon={<app.icon size={18} />}
                  selected={activeApp.id === app.id}
                  title={app.label}
                  aria-label={app.label}
                  onClick={() => handleAppClick(app)}
                  onMouseEnter={app.onPrefetch}
                  onFocus={app.onPrefetch}
                />
              ))}
            </div>
          </div>
          <div className={styles.spacer} />
        </>
      ) : isBar ? (
        <div className={styles.barGroup}>
          {primaryApps.map((app) => (
            <NavRailButton
              key={app.id}
              icon={<app.icon size={17} />}
              label={app.label}
              selected={activeApp.id === app.id}
              title={app.label}
              aria-label={app.label}
              className={styles.navBarBtn}
              onClick={() => handleAppClick(app)}
              onMouseEnter={app.onPrefetch}
              onFocus={app.onPrefetch}
            />
          ))}
        </div>
      ) : canReorder ? (
        <div className={styles.taskbarGroup}>
          {primaryApps.map((app) => (
            <SortableTaskbarAppButton
              key={app.id}
              app={app}
              selected={activeApp.id === app.id}
              onClick={() => handleTaskbarAppClick(app)}
              onPointerDown={handleTaskbarPointerDown}
            />
          ))}
        </div>
      ) : (
        <div className={styles.taskbarGroup}>
          {primaryApps.map((app) => (
            <TaskbarIconButton
              key={app.id}
              icon={<app.icon size={TASKBAR_ICON_SIZE} />}
              selected={activeApp.id === app.id}
              title={app.label}
              aria-label={app.label}
              onClick={() => handleTaskbarAppClick(app)}
              onMouseEnter={app.onPrefetch}
              onFocus={app.onPrefetch}
            />
          ))}
        </div>
      )}
    </nav>
  );
}
