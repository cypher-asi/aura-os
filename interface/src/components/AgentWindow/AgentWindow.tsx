import { memo, useCallback, useEffect, useRef } from "react";
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
const DEBUG_RUN_ID = "drag-rootcause-pre";
function debugConsole(hypothesisId: string, message: string, data: Record<string, unknown>) {
  const payload = { runId: DEBUG_RUN_ID, hypothesisId, message, ...data, timestamp: Date.now() };
  // #region agent log
  console.debug("[drag-debug]", payload);
  console.debug("[drag-debug-json]", JSON.stringify(payload));
  // #endregion
}

const AgentChatWindowPanel = memo(function AgentChatWindowPanel({ agentId }: { agentId: string }) {
  const chatProps = useAgentChatWindow(agentId);

  if (!chatProps.ready) return null;

  return (
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
  );
});

export const AgentWindow = memo(function AgentWindow({ win, isFocused }: AgentWindowProps) {
  const { agentId, minimized, maximized } = win;

  const focusWindow = useDesktopWindowStore((s) => s.focusWindow);
  const minimizeWindow = useDesktopWindowStore((s) => s.minimizeWindow);
  const maximizeWindow = useDesktopWindowStore((s) => s.maximizeWindow);
  const closeWindow = useDesktopWindowStore((s) => s.closeWindow);
  const moveWindow = useDesktopWindowStore((s) => s.moveWindow);
  const resizeWindow = useDesktopWindowStore((s) => s.resizeWindow);

  const agent = useAgentStore((s) => s.agents.find((a) => a.agent_id === agentId));
  const { status, isLocal } = useAvatarState(agentId);
  const titleBarRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; winX: number; winY: number } | null>(null);
  const dragPointerIdRef = useRef<number | null>(null);
  const dragListenersAttachedRef = useRef(false);
  const dragMoveCountRef = useRef(0);
  const renderCountRef = useRef(0);
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
      dragMoveCountRef.current += 1;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      moveWindow(agentId, d.winX + dx, Math.max(0, d.winY + dy));
      if (dragMoveCountRef.current % 25 === 0) {
        debugConsole("H3", "drag_move_sample", {
          location: "AgentWindow.tsx:handleGlobalPointerMove",
          agentId,
          moveCount: dragMoveCountRef.current,
          dx,
          dy,
          hasCapture: !!titleBarRef.current?.hasPointerCapture(e.pointerId),
          usingGlobalListeners: true,
        });
        // #region agent log
        fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5df55f" }, body: JSON.stringify({ sessionId: "5df55f", runId: DEBUG_RUN_ID, hypothesisId: "H3", location: "AgentWindow.tsx:handleGlobalPointerMove", message: "drag_move_sample", data: { agentId, moveCount: dragMoveCountRef.current, dx, dy, hasCapture: !!titleBarRef.current?.hasPointerCapture(e.pointerId), usingGlobalListeners: true }, timestamp: Date.now() }) }).catch(() => {});
        // #endregion
      }
    },
    [agentId, moveWindow],
  );

  const handleGlobalPointerUp = useCallback(
    (e: PointerEvent) => {
      if (!dragRef.current) return;
      if (dragPointerIdRef.current !== null && e.pointerId !== dragPointerIdRef.current) return;
      debugConsole("H1", "drag_end_release", {
        location: "AgentWindow.tsx:handleGlobalPointerUp",
        agentId,
        pointerId: e.pointerId,
        moveCount: dragMoveCountRef.current,
        stillCapturedAfterRelease: !!titleBarRef.current?.hasPointerCapture(e.pointerId),
        usingGlobalListeners: true,
      });
      // #region agent log
      fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5df55f" }, body: JSON.stringify({ sessionId: "5df55f", runId: DEBUG_RUN_ID, hypothesisId: "H1", location: "AgentWindow.tsx:handleGlobalPointerUp", message: "drag_end_release", data: { agentId, pointerId: e.pointerId, moveCount: dragMoveCountRef.current, stillCapturedAfterRelease: !!titleBarRef.current?.hasPointerCapture(e.pointerId), usingGlobalListeners: true }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
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
      dragMoveCountRef.current = 0;
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
      debugConsole("H1", "drag_start_capture", {
        location: "AgentWindow.tsx:handleTitleBarPointerDown",
        agentId,
        pointerId: e.pointerId,
        hasCapture: !!titleBarRef.current?.hasPointerCapture(e.pointerId),
        usingGlobalListeners: true,
        winX: win.x,
        winY: win.y,
      });
      // #region agent log
      fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5df55f" }, body: JSON.stringify({ sessionId: "5df55f", runId: DEBUG_RUN_ID, hypothesisId: "H1", location: "AgentWindow.tsx:handleTitleBarPointerDown", message: "drag_start_capture", data: { agentId, pointerId: e.pointerId, hasCapture: !!titleBarRef.current?.hasPointerCapture(e.pointerId), winX: win.x, winY: win.y }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
    },
    [agentId, focusWindow, handleGlobalPointerMove, handleGlobalPointerUp, win.x, win.y],
  );

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
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
        const candidateY = r.winY + dy;
        if (newH >= MIN_HEIGHT && candidateY >= 0) newY = candidateY;
        else if (candidateY < 0) { newH = r.winH + r.winY; newY = 0; }
        else newH = MIN_HEIGHT;
      }

      newW = Math.max(MIN_WIDTH, newW);
      newH = Math.max(MIN_HEIGHT, newH);

      moveWindow(agentId, newX, Math.max(0, newY));
      resizeWindow(agentId, newW, newH);
    },
    [agentId, moveWindow, resizeWindow],
  );

  const handleResizePointerUp = useCallback((e: React.PointerEvent) => {
    if (resizeRef.current) {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      resizeRef.current = null;
    }
  }, []);

  if (minimized) return null;

  useEffect(() => {
    renderCountRef.current += 1;
    if (renderCountRef.current % 20 === 0) {
      debugConsole("H2", "window_render_sample", {
        location: "AgentWindow.tsx:useEffect(render)",
        agentId,
        renderCount: renderCountRef.current,
        x: win.x,
        y: win.y,
        isFocused,
      });
      // #region agent log
      fetch("http://127.0.0.1:7836/ingest/c96ab900-9f38-42f7-81b1-bd596c64b5c4", { method: "POST", headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5df55f" }, body: JSON.stringify({ sessionId: "5df55f", runId: DEBUG_RUN_ID, hypothesisId: "H2", location: "AgentWindow.tsx:useEffect(render)", message: "window_render_sample", data: { agentId, renderCount: renderCountRef.current, x: win.x, y: win.y, isFocused }, timestamp: Date.now() }) }).catch(() => {});
      // #endregion
    }
  });

  useEffect(() => {
    return () => {
      detachGlobalDragListeners();
      dragRef.current = null;
      dragPointerIdRef.current = null;
    };
  }, [detachGlobalDragListeners]);

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
        <AgentChatWindowPanel agentId={agentId} />
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
});
