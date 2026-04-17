import { memo, useCallback, useEffect, useRef } from "react";
import { Minus, Square, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useDesktopWindowStore, MIN_WIDTH, MIN_HEIGHT } from "../../stores/desktop-window-store";
import type { WindowState } from "../../stores/desktop-window-store";
import { useAgentChatWindow } from "../../hooks/use-agent-chat-window";
import { useAvatarState } from "../../hooks/use-avatar-state";
import { useAgentStore } from "../../apps/agents/stores";
import { Avatar } from "../Avatar";
import { ChatPanel } from "../ChatPanel";
import styles from "./AgentWindow.module.css";

interface AgentWindowProps {
  win: WindowState;
  isFocused: boolean;
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const AgentChatWindowPanel = memo(function AgentChatWindowPanel({ agentId }: { agentId: string }) {
  const chatProps = useAgentChatWindow(agentId);

  return (
    <ChatPanel
      streamKey={chatProps.streamKey}
      onSend={chatProps.onSend}
      onStop={chatProps.onStop}
      agentName={chatProps.agentName}
      machineType={chatProps.machineType}
      adapterType={chatProps.adapterType}
      defaultModel={chatProps.defaultModel}
      templateAgentId={chatProps.templateAgentId}
      agentId={chatProps.agentId}
      isLoading={chatProps.isLoading}
      historyResolved={chatProps.historyResolved}
      errorMessage={chatProps.errorMessage}
      emptyMessage={chatProps.emptyMessage}
      scrollResetKey={chatProps.scrollResetKey}
      historyMessages={chatProps.historyMessages}
      projects={chatProps.projects}
      selectedProjectId={chatProps.selectedProjectId}
      onProjectChange={chatProps.onProjectChange}
      contextUtilization={chatProps.contextUtilization}
      onNewSession={chatProps.onNewSession}
    />
  );
});

export const AgentWindow = memo(function AgentWindow({ win, isFocused }: AgentWindowProps) {
  const { agentId, minimized, maximized } = win;

  const focusWindow = useDesktopWindowStore((s) => s.focusWindow);
  const minimizeWindow = useDesktopWindowStore((s) => s.minimizeWindow);
  const maximizeWindow = useDesktopWindowStore((s) => s.maximizeWindow);
  const closeWindow = useDesktopWindowStore((s) => s.closeWindow);
  const moveWindow = useDesktopWindowStore((s) => s.moveWindow);
  const setWindowRect = useDesktopWindowStore((s) => s.setWindowRect);

  const agent = useAgentStore(
    useShallow((state) => {
      const match = state.agents.find((candidate) => candidate.agent_id === agentId);
      return {
        icon: match?.icon ?? null,
        name: match?.name ?? "Agent",
      };
    }),
  );
  const { status, isLocal } = useAvatarState(agentId);
  const titleBarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragListenersAttachedRef = useRef(false);
  const resizePointerIdRef = useRef<number | null>(null);
  const resizeListenersAttachedRef = useRef(false);
  const resizeMoveCountRef = useRef(0);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    winW: number;
    winH: number;
  } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    if (!isFocused) focusWindow(agentId);
  }, [isFocused, focusWindow, agentId]);

  const detachGlobalDragListeners = useCallback(() => {
    if (!dragListenersAttachedRef.current) return;
    window.removeEventListener("pointermove", handleGlobalPointerMove);
    window.removeEventListener("pointerup", handleGlobalPointerUp);
    dragListenersAttachedRef.current = false;
  }, []);

  const handleGlobalPointerMove = useCallback(
    (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (dragPointerIdRef.current !== null && e.pointerId !== dragPointerIdRef.current) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      moveWindow(agentId, d.winX + dx, Math.max(0, d.winY + dy));
    },
    [agentId, moveWindow],
  );

  const handleGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (dragPointerIdRef.current !== null && e.pointerId !== dragPointerIdRef.current) return;
      dragRef.current = null;
      dragPointerIdRef.current = null;
      detachGlobalDragListeners();
    },
    [agentId, detachGlobalDragListeners],
  );

  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      focusWindow(agentId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
      };
      dragPointerIdRef.current = e.pointerId;
      if (!dragListenersAttachedRef.current) {
        window.addEventListener("pointermove", handleGlobalPointerMove);
        window.addEventListener("pointerup", handleGlobalPointerUp);
        dragListenersAttachedRef.current = true;
      }
    },
    [agentId, focusWindow, handleGlobalPointerMove, handleGlobalPointerUp, win.x, win.y],
  );

  const handleResizePointerDown = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusWindow(agentId);
      resizeMoveCountRef.current = 0;
      resizePointerIdRef.current = e.pointerId;
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
        winW: win.width,
        winH: win.height,
      };
      if (!resizeListenersAttachedRef.current) {
        window.addEventListener("pointermove", handleGlobalResizePointerMove);
        window.addEventListener("pointerup", handleGlobalResizePointerUp);
        resizeListenersAttachedRef.current = true;
      }
    },
    [agentId, focusWindow, isFocused, win.x, win.y, win.width, win.height],
  );

  const handleGlobalResizePointerMove = useCallback(
    (e: PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
      resizeMoveCountRef.current += 1;
      const dx = e.clientX - r.startX;
      const dy = e.clientY - r.startY;

      let newX = r.winX;
      let newY = r.winY;
      let newW = r.winW;
      let newH = r.winH;

      if (r.dir.includes("e")) newW = r.winW + dx;
      if (r.dir.includes("w")) {
        newW = r.winW - dx;
        if (newW >= MIN_WIDTH) newX = r.winX + dx;
        else newW = MIN_WIDTH;
      }
      if (r.dir.includes("s")) newH = r.winH + dy;
      if (r.dir.includes("n")) {
        newH = r.winH - dy;
        const candidateY = r.winY + dy;
        if (newH >= MIN_HEIGHT && candidateY >= 0) newY = candidateY;
        else if (candidateY < 0) { newH = r.winH + r.winY; newY = 0; }
        else newH = MIN_HEIGHT;
      }

      newW = Math.max(MIN_WIDTH, newW);
      newH = Math.max(MIN_HEIGHT, newH);

      setWindowRect(agentId, newX, Math.max(0, newY), newW, newH);
    },
    [agentId, setWindowRect],
  );

  const handleGlobalResizePointerUp = useCallback((e: PointerEvent) => {
    if (resizeRef.current) {
      if (resizePointerIdRef.current !== null && e.pointerId !== resizePointerIdRef.current) return;
      resizeRef.current = null;
      resizePointerIdRef.current = null;
      if (resizeListenersAttachedRef.current) {
        window.removeEventListener("pointermove", handleGlobalResizePointerMove);
        window.removeEventListener("pointerup", handleGlobalResizePointerUp);
        resizeListenersAttachedRef.current = false;
      }
    }
  }, [agentId, handleGlobalResizePointerMove]);

  if (minimized) return null;

  useEffect(() => {
    return () => {
      detachGlobalDragListeners();
      if (resizeListenersAttachedRef.current) {
        window.removeEventListener("pointermove", handleGlobalResizePointerMove);
        window.removeEventListener("pointerup", handleGlobalResizePointerUp);
        resizeListenersAttachedRef.current = false;
      }
      dragRef.current = null;
      dragPointerIdRef.current = null;
      resizeRef.current = null;
      resizePointerIdRef.current = null;
    };
  }, [detachGlobalDragListeners, handleGlobalResizePointerMove, handleGlobalResizePointerUp]);

  const windowStyle: React.CSSProperties = maximized
    ? { inset: 0, width: "100%", height: "100%", zIndex: win.zIndex }
    : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex };

  const cls = [
    styles.window,
    isFocused && styles.windowFocused,
    maximized && styles.windowMaximized,
  ]
    .filter(Boolean)
    .join(" ");

  const resizeHandles: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const resizeClassMap: Record<ResizeDir, string> = {
    n: styles.resizeN,
    s: styles.resizeS,
    e: styles.resizeE,
    w: styles.resizeW,
    ne: styles.resizeNE,
    nw: styles.resizeNW,
    se: styles.resizeSE,
    sw: styles.resizeSW,
  };

  return (
    <div
      className={cls}
      style={windowStyle}
      onPointerDown={handlePointerDown}
    >
      <div
        ref={titleBarRef}
        className={styles.titleBar}
        onPointerDown={handleTitleBarPointerDown}
        onDoubleClick={() => maximizeWindow(agentId)}
      >
        <div className={styles.titleInfo}>
          <Avatar
            avatarUrl={agent.icon ?? undefined}
            name={agent.name}
            type="agent"
            size={18}
            status={status}
            isLocal={isLocal}
          />
          <span className={styles.titleName}>{agent.name}</span>
        </div>
        <div className={styles.titleControls}>
          <button
            type="button"
            className={styles.controlBtn}
            title="Minimize"
            onClick={() => minimizeWindow(agentId)}
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            className={styles.controlBtn}
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => maximizeWindow(agentId)}
          >
            <Square size={11} />
          </button>
          <button
            type="button"
            className={`${styles.controlBtn} ${styles.controlBtnClose}`}
            title="Close"
            onClick={() => closeWindow(agentId)}
          >
            <X size={13} />
          </button>
        </div>
      </div>
      <div className={styles.body}>
        <AgentChatWindowPanel agentId={agentId} />
      </div>
      {!maximized &&
        resizeHandles.map((dir) => (
          <div
            key={dir}
            className={resizeClassMap[dir]}
            onPointerDown={handleResizePointerDown(dir)}
          />
        ))}
    </div>
  );
});
