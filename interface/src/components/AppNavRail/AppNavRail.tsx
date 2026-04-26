import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { createPortal, flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import type { AuraApp } from "../../apps/types";
import { getOrderedTaskbarApps, useAppStore } from "../../stores/app-store";
import { useActiveApp } from "../../hooks/use-active-app";
import {
  getLastAgent,
  getLastProcessId,
  getLastProject,
  getLastStandaloneAgentId,
} from "../../utils/storage";
import styles from "./AppNavRail.module.css";

export const TASKBAR_ICON_SIZE = 15;

function resolveAppPath(app: { id: string; basePath: string }): string {
  if (app.id === "agents") {
    const lastId = getLastStandaloneAgentId();
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
    const lastId = getLastProcessId();
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

export interface TaskbarIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  selected?: boolean;
  children?: ReactNode;
}

export function TaskbarIconButton({
  icon,
  selected = false,
  className,
  children,
  ...props
}: TaskbarIconButtonProps) {
  const cls = [styles.taskbarBtn, className ?? ""].filter(Boolean).join(" ");

  return (
    <button
      type="button"
      className={cls}
      aria-pressed={selected}
      data-selected={selected || undefined}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

type AppNavItem = Pick<AuraApp, "id" | "label" | "agentDescription" | "agentKeywords" | "basePath" | "icon" | "onPrefetch">;
type TaskbarButtonRect = {
  id: string;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
};

type TaskbarDragState = {
  activeId: string;
  activeVisibleIndex: number;
  buttonRects: TaskbarButtonRect[];
  overlayRect: { left: number; top: number; width: number; height: number };
  pointerDeltaX: number;
  targetVisibleIndex: number;
  visibleIds: string[];
};

function getTargetVisibleIndex(
  buttonRects: TaskbarButtonRect[],
  activeId: string,
  draggedCenterX: number,
): number {
  return buttonRects.reduce((count, rect) => {
    if (rect.id === activeId) return count;
    return count + (draggedCenterX > rect.centerX ? 1 : 0);
  }, 0);
}

function moveVisibleTaskbarAppOrder(
  fullOrder: string[],
  visibleIds: string[],
  activeId: string,
  targetVisibleIndex: number,
): string[] {
  const withoutActive = fullOrder.filter((id) => id !== activeId);
  const visibleWithoutActive = visibleIds.filter((id) => id !== activeId);
  const beforeId = visibleWithoutActive[targetVisibleIndex] ?? null;

  if (!beforeId) return [...withoutActive, activeId];

  const insertIndex = withoutActive.indexOf(beforeId);
  if (insertIndex === -1) return fullOrder;

  return [
    ...withoutActive.slice(0, insertIndex),
    activeId,
    ...withoutActive.slice(insertIndex),
  ];
}

function getTaskbarDragButtonStyle(appId: string, dragState: TaskbarDragState | null): CSSProperties | undefined {
  if (!dragState) return undefined;

  const currentIndex = dragState.buttonRects.findIndex((rect) => rect.id === appId);
  if (currentIndex === -1) return undefined;

  if (appId === dragState.activeId) {
    return { opacity: 0, pointerEvents: "none" };
  }

  if (
    dragState.targetVisibleIndex > dragState.activeVisibleIndex &&
    currentIndex > dragState.activeVisibleIndex &&
    currentIndex <= dragState.targetVisibleIndex
  ) {
    const currentRect = dragState.buttonRects[currentIndex];
    const previousRect = dragState.buttonRects[currentIndex - 1];
    return { transform: `translateX(${previousRect.left - currentRect.left}px)` };
  }

  if (
    dragState.targetVisibleIndex < dragState.activeVisibleIndex &&
    currentIndex >= dragState.targetVisibleIndex &&
    currentIndex < dragState.activeVisibleIndex
  ) {
    const currentRect = dragState.buttonRects[currentIndex];
    const nextRect = dragState.buttonRects[currentIndex + 1];
    return { transform: `translateX(${nextRect.left - currentRect.left}px)` };
  }

  return undefined;
}

interface SortableTaskbarAppButtonProps {
  app: AppNavItem;
  selected: boolean;
  onClick: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, appId: string) => void;
  style?: CSSProperties;
}

function SortableTaskbarAppButton({
  app,
  selected,
  onClick,
  onPointerDown,
  style,
}: SortableTaskbarAppButtonProps) {
  return (
    <TaskbarIconButton
      icon={<app.icon size={TASKBAR_ICON_SIZE} />}
      selected={selected}
      data-taskbar-app-id={app.id}
      data-agent-role="app-launcher"
      data-agent-app-id={app.id}
      data-agent-app-label={app.label}
      data-agent-route={app.basePath}
      data-agent-description={app.agentDescription || app.label}
      data-agent-keywords={(app.agentKeywords ?? []).join(",")}
      title={app.label}
      aria-label={app.label}
      style={style}
      onClick={onClick}
      onPointerDown={(event) => onPointerDown(event, app.id)}
      onMouseEnter={app.onPrefetch}
      onFocus={app.onPrefetch}
    />
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
  const activeApp = useActiveApp();
  const taskbarAppOrder = useAppStore((s) => s.taskbarAppOrder);
  const taskbarHiddenAppIds = useAppStore((s) => s.taskbarHiddenAppIds);
  const saveTaskbarAppOrder = useAppStore((s) => s.saveTaskbarAppOrder);
  const navigate = useNavigate();
  const includeSet = includeIds ? new Set(includeIds) : null;
  const excludeSet = new Set(excludeIds);
  const hiddenSet = useMemo(() => new Set(taskbarHiddenAppIds), [taskbarHiddenAppIds]);
  const orderedApps = useMemo(
    () => (layout === "taskbar" ? getOrderedTaskbarApps(apps, taskbarAppOrder) : apps),
    [apps, layout, taskbarAppOrder],
  );
  const primaryApps = orderedApps.filter((app) => {
    if (app.id === "desktop") return false;
    if (excludeSet.has(app.id)) return false;
    if (includeSet && !includeSet.has(app.id)) return false;
    if (layout === "taskbar" && hiddenSet.has(app.id)) return false;
    return true;
  });
  const isRail = layout === "rail";
  const isBar = layout === "bar";
  const [dragState, setDragState] = useState<TaskbarDragState | null>(null);
  const [suppressTaskbarTransitions, setSuppressTaskbarTransitions] = useState(false);
  const handleAppClick = useCallback(
    (app: { id: string; basePath: string }) => navigate(resolveAppPath(app)),
    [navigate],
  );
  const canReorder = layout === "taskbar" && allowReorder && primaryApps.length > 1;
  const suppressClickRef = useRef<string | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const transitionResetFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (transitionResetFrameRef.current !== null) {
        cancelAnimationFrame(transitionResetFrameRef.current);
      }
      dragCleanupRef.current?.();
    },
    [],
  );
  useEffect(() => {
    if (!canReorder && dragState) {
      dragCleanupRef.current?.();
      setDragState(null);
    }
  }, [canReorder, dragState]);
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
  const suppressDropTransition = useCallback(() => {
    if (transitionResetFrameRef.current !== null) {
      cancelAnimationFrame(transitionResetFrameRef.current);
    }
    setSuppressTaskbarTransitions(true);
    transitionResetFrameRef.current = requestAnimationFrame(() => {
      transitionResetFrameRef.current = requestAnimationFrame(() => {
        setSuppressTaskbarTransitions(false);
        transitionResetFrameRef.current = null;
      });
    });
  }, []);
  const handleTaskbarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, appId: string) => {
      if (!canReorder || event.button !== 0) return;

      suppressClickRef.current = null;
      dragCleanupRef.current?.();
      setDragState(null);

      const target = event.currentTarget;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const group = target.parentElement;
      const buttons = group
        ? Array.from(group.querySelectorAll<HTMLButtonElement>("[data-taskbar-app-id]"))
        : [];
      const buttonRects = buttons
        .map((button) => {
          const rect = button.getBoundingClientRect();
          const id = button.dataset.taskbarAppId;
          if (!id) return null;
          return {
            id,
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            centerX: rect.left + rect.width / 2,
          } satisfies TaskbarButtonRect;
        })
        .filter((rect): rect is TaskbarButtonRect => rect !== null);
      const activeVisibleIndex = buttonRects.findIndex((rect) => rect.id === appId);
      const activeRect = buttonRects[activeVisibleIndex];
      let dragging = false;
      let latestTargetVisibleIndex = activeVisibleIndex;
      let pointerCaptured = false;

      if (!activeRect || activeVisibleIndex === -1) return;

      const cleanup = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
        if (
          pointerCaptured &&
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

        const pointerDeltaX = moveEvent.clientX - startX;

        if (!dragging) {
          if (Math.abs(pointerDeltaX) < 6) return;
          dragging = true;
          if (typeof target.setPointerCapture === "function") {
            target.setPointerCapture(pointerId);
            pointerCaptured = true;
          }
        }

        moveEvent.preventDefault();
        latestTargetVisibleIndex = getTargetVisibleIndex(
          buttonRects,
          appId,
          activeRect.centerX + pointerDeltaX,
        );
        setDragState({
          activeId: appId,
          activeVisibleIndex,
          buttonRects,
          overlayRect: {
            left: activeRect.left,
            top: activeRect.top,
            width: activeRect.width,
            height: activeRect.height,
          },
          pointerDeltaX,
          targetVisibleIndex: latestTargetVisibleIndex,
          visibleIds: buttonRects.map((rect) => rect.id),
        });
      };

      const handlePointerEnd = (endEvent: PointerEvent) => {
        if (endEvent.pointerId !== pointerId) return;

        cleanup();
        if (dragging) {
          const nextOrder = moveVisibleTaskbarAppOrder(
            taskbarAppOrder,
            buttonRects.map((rect) => rect.id),
            appId,
            latestTargetVisibleIndex,
          );
          suppressClickRef.current = appId;
          flushSync(() => {
            suppressDropTransition();
            if (nextOrder.join("|") !== taskbarAppOrder.join("|")) {
              saveTaskbarAppOrder(nextOrder);
            }
            setDragState(null);
          });
          return;
        }

        setDragState(null);
      };

      dragCleanupRef.current = cleanup;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);
    },
    [canReorder, saveTaskbarAppOrder, suppressDropTransition, taskbarAppOrder],
  );
  const primaryAppsById = useMemo<Map<string, AppNavItem>>(
    () => new Map(primaryApps.map((app) => [app.id, app])),
    [primaryApps],
  );
  const renderTaskbarApps = useMemo<AppNavItem[]>(() => {
    if (!dragState) return primaryApps;

    const nextApps: AppNavItem[] = [];
    for (const id of dragState.visibleIds) {
      const app = primaryAppsById.get(id);
      if (app) nextApps.push(app);
    }
    return nextApps;
  }, [dragState, primaryApps, primaryAppsById]);

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
                  data-agent-role="app-launcher"
                  data-agent-app-id={app.id}
                  data-agent-app-label={app.label}
                  data-agent-route={app.basePath}
                  data-agent-description={app.agentDescription || app.label}
                  data-agent-keywords={(app.agentKeywords ?? []).join(",")}
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
              data-agent-role="app-launcher"
              data-agent-app-id={app.id}
              data-agent-app-label={app.label}
              data-agent-route={app.basePath}
              data-agent-description={app.agentDescription || app.label}
              data-agent-keywords={(app.agentKeywords ?? []).join(",")}
              className={styles.navBarBtn}
              onClick={() => handleAppClick(app)}
              onMouseEnter={app.onPrefetch}
              onFocus={app.onPrefetch}
            />
          ))}
        </div>
      ) : canReorder ? (
        <div className={styles.taskbarGroup}>
          {renderTaskbarApps.map((app) => (
            <SortableTaskbarAppButton
              key={app.id}
              app={app}
              selected={activeApp.id === app.id}
              onClick={() => handleTaskbarAppClick(app)}
              onPointerDown={handleTaskbarPointerDown}
              style={{
                ...getTaskbarDragButtonStyle(app.id, dragState),
                ...(suppressTaskbarTransitions ? { transition: "none" } : null),
              }}
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
              data-agent-role="app-launcher"
              data-agent-app-id={app.id}
              data-agent-app-label={app.label}
              data-agent-route={app.basePath}
              data-agent-description={app.agentDescription || app.label}
              data-agent-keywords={(app.agentKeywords ?? []).join(",")}
              onClick={() => handleTaskbarAppClick(app)}
              onMouseEnter={app.onPrefetch}
              onFocus={app.onPrefetch}
            />
          ))}
        </div>
      )}
      {dragState && primaryAppsById.get(dragState.activeId) && typeof document !== "undefined"
        ? createPortal(
            <button
              type="button"
              className={`${styles.taskbarBtn} ${styles.taskbarDragOverlay}`}
              data-selected={activeApp.id === dragState.activeId}
              title={primaryAppsById.get(dragState.activeId)?.label}
              aria-label={primaryAppsById.get(dragState.activeId)?.label}
              style={{
                left: dragState.overlayRect.left + dragState.pointerDeltaX,
                top: dragState.overlayRect.top,
                width: dragState.overlayRect.width,
                height: dragState.overlayRect.height,
              }}
            >
              {(() => {
                const activeDragApp = primaryAppsById.get(dragState.activeId);
                if (!activeDragApp) return null;
                return <activeDragApp.icon size={TASKBAR_ICON_SIZE} />;
              })()}
            </button>,
            document.body,
          )
        : null}
    </nav>
  );
}
