import { useCallback, useRef } from "react";
import { Minus, Square, X } from "lucide-react";
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

export function AgentWindow({ win, isFocused }: AgentWindowProps) {
  const { agentId, minimized, maximized } = win;

  const focusWindow = useDesktopWindowStore((s) => s.focusWindow);
  const minimizeWindow = useDesktopWindowStore((s) => s.minimizeWindow);
  const maximizeWindow = useDesktopWindowStore((s) => s.maximizeWindow);
  const closeWindow = useDesktopWindowStore((s) => s.closeWindow);
  const moveWindow = useDesktopWindowStore((s) => s.moveWindow);
  const resizeWindow = useDesktopWindowStore((s) => s.resizeWindow);

  const agent = useAgentStore((s) => s.agents.find((a) => a.agent_id === agentId));
  const { status, isLocal } = useAvatarState(agentId);
  const chatProps = useAgentChatWindow(agentId);

  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const resizeRef = useRef<{
    dir: ResizeDir;
    startX: number;
    startY: number;
    winX: number;
    winY: number;
    winW: number;
    winH: number;
  } | null>(null);

  const handlePointerDown = useCallback(() => {
    if (!isFocused) focusWindow(agentId);
  }, [isFocused, focusWindow, agentId]);

  const handleTitleBarPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();
      focusWindow(agentId);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [agentId, focusWindow, win.x, win.y],
  );

  const handleTitleBarPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      moveWindow(agentId, d.winX + dx, d.winY + dy);
    },
    [agentId, moveWindow],
  );

  const handleTitleBarPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  const handleResizePointerDown = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      focusWindow(agentId);
      resizeRef.current = {
        dir,
        startX: e.clientX,
        startY: e.clientY,
        winX: win.x,
        winY: win.y,
        winW: win.width,
        winH: win.height,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [agentId, focusWindow, win.x, win.y, win.width, win.height],
  );

  const handleResizePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const r = resizeRef.current;
      if (!r) return;
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
        if (newH >= MIN_HEIGHT) newY = r.winY + dy;
        else newH = MIN_HEIGHT;
      }

      newW = Math.max(MIN_WIDTH, newW);
      newH = Math.max(MIN_HEIGHT, newH);

      moveWindow(agentId, newX, newY);
      resizeWindow(agentId, newW, newH);
    },
    [agentId, moveWindow, resizeWindow],
  );

  const handleResizePointerUp = useCallback(() => {
    resizeRef.current = null;
  }, []);

  if (minimized) return null;

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
        className={styles.titleBar}
        onPointerDown={handleTitleBarPointerDown}
        onPointerMove={handleTitleBarPointerMove}
        onPointerUp={handleTitleBarPointerUp}
        onDoubleClick={() => maximizeWindow(agentId)}
      >
        <div className={styles.titleInfo}>
          <Avatar
            avatarUrl={agent?.icon ?? undefined}
            name={agent?.name}
            type="agent"
            size={18}
            status={status}
            isLocal={isLocal}
          />
          <span className={styles.titleName}>{agent?.name ?? "Agent"}</span>
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
        {chatProps.ready && (
          <ChatPanel
            key={agentId}
            streamKey={chatProps.streamKey}
            onSend={chatProps.onSend}
            onStop={chatProps.onStop}
            agentName={chatProps.agentName}
            machineType={chatProps.machineType}
            templateAgentId={chatProps.templateAgentId}
            agentId={chatProps.agentId}
            isLoading={chatProps.isLoading}
            historyResolved={chatProps.historyResolved}
            errorMessage={chatProps.errorMessage}
            emptyMessage={chatProps.emptyMessage}
            scrollResetKey={chatProps.scrollResetKey}
            projects={chatProps.projects}
            selectedProjectId={chatProps.selectedProjectId}
            onProjectChange={chatProps.onProjectChange}
          />
        )}
      </div>
      {!maximized &&
        resizeHandles.map((dir) => (
          <div
            key={dir}
            className={resizeClassMap[dir]}
            onPointerDown={handleResizePointerDown(dir)}
            onPointerMove={handleResizePointerMove}
            onPointerUp={handleResizePointerUp}
          />
        ))}
    </div>
  );
}
