import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Text, Item, ModalConfirm, Tabs } from "@cypher-asi/zui";
import { Trash2, Play, Pause, Square, Loader2, Plus, X } from "lucide-react";
import {
  useTaskOutputPanelStore,
  useTasksForProject,
  type OutputPanelTab,
} from "../../stores/task-output-panel-store";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";
import { useShallow } from "zustand/react/shallow";
import { useEventStore } from "../../stores/event-store";
import { useProjectActions } from "../../stores/project-action-store";
import { useAutomationStatus } from "../AutomationBar/useAutomationStatus";
import { EventType } from "../../types/aura-events";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { ActiveTaskStream } from "./ActiveTaskStream";
import { CompletedTaskOutput } from "./CompletedTaskOutput";
import styles from "./TaskOutputPanel.module.css";

function useActiveTaskTracking() {
  const subscribe = useEventStore((s) => s.subscribe);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { addTask, completeTask, failTask, markAllCompleted } = useTaskOutputPanelStore.getState();

  useEffect(() => {
    const unsubs = [
      subscribe(EventType.TaskStarted, (e) => {
        const { task_id, task_title } = e.content;
        const pid = e.project_id || projectId;
        if (task_id && pid) addTask(task_id, pid, task_title, e.agent_id || undefined);
      }),
      subscribe(EventType.TaskCompleted, (e) => {
        if (e.content.task_id) completeTask(e.content.task_id);
      }),
      subscribe(EventType.TaskFailed, (e) => {
        if (e.content.task_id) failTask(e.content.task_id);
      }),
      subscribe(EventType.LoopStopped, () => markAllCompleted()),
      subscribe(EventType.LoopFinished, () => markAllCompleted()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, projectId, addTask, completeTask, failTask, markAllCompleted]);
}

function AutomationControls({ projectId }: { projectId: string }) {
  const {
    canPlay, canPause, canStop, starting, preparing,
    handleStart, handlePause, handleStop, handleStopConfirm,
    confirmStop, setConfirmStop,
  } = useAutomationStatus(projectId);

  const showStopPause = canPause || canStop;

  return (
    <>
      {!showStopPause && (
        <button
          type="button"
          className={styles.runBtnGroup}
          onClick={handleStart}
          disabled={!canPlay}
          title="Run"
          aria-label="Run automation"
        >
          {starting || preparing
            ? <Loader2 size={11} className={styles.spinner} />
            : <Play size={11} />}
          <span>Run</span>
        </button>
      )}
      {showStopPause && (
        <>
          {canPlay && (
            <button
              type="button"
              className={styles.runBtnGroup}
              onClick={handleStart}
              title="Resume"
              aria-label="Resume automation"
            >
              <Play size={11} />
              <span>Run</span>
            </button>
          )}
          {canPause && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={handlePause}
              title="Pause"
              aria-label="Pause automation"
            >
              <Pause size={11} />
            </button>
          )}
          <button
            type="button"
            className={styles.headerBtn}
            onClick={handleStop}
            disabled={!canStop}
            title="Stop"
            aria-label="Stop automation"
          >
            <Square size={11} />
          </button>
        </>
      )}

      <ModalConfirm
        isOpen={confirmStop}
        onClose={() => setConfirmStop(false)}
        onConfirm={handleStopConfirm}
        title="Stop Execution"
        message="Stop autonomous execution? The current task will complete first."
        confirmLabel="Stop"
        cancelLabel="Cancel"
        danger
      />
    </>
  );
}

function PanelTabs({
  activeTab,
  onTabChange,
  isRunning,
}: {
  activeTab: OutputPanelTab;
  onTabChange: (tab: OutputPanelTab) => void;
  isRunning: boolean;
}) {
  const addTerminal = useTerminalPanelStore((s) => s.addTerminal);

  const tabs = [
    {
      id: "run",
      label: (
        <>
          <span className={isRunning ? styles.tabDotActive : styles.tabDotIdle} />
          Run
        </>
      ),
    },
    { id: "terminal", label: "Terminal" },
  ];

  return (
    <div className={styles.headerTabs}>
      <Tabs
        tabs={tabs as any}
        value={activeTab}
        onChange={(id) => onTabChange(id as OutputPanelTab)}
        size="sm"
        className={styles.panelTabsRoot}
        tabClassName={styles.panelTabBtn}
      />
      <button
        type="button"
        className={styles.addTerminalBtn}
        onClick={() => {
          addTerminal();
          onTabChange("terminal");
        }}
        title="New terminal"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}

function TerminalInstanceTabs() {
  const { terminals, activeId, setActiveId, removeTerminal } = useTerminalPanelStore(
    useShallow((s) => ({
      terminals: s.terminals,
      activeId: s.activeId,
      setActiveId: s.setActiveId,
      removeTerminal: s.removeTerminal,
    })),
  );

  if (terminals.length <= 1) return null;

  return (
    <div className={styles.terminalInstanceTabs}>
      {terminals.map((t, i) => (
        <button
          key={t.id}
          type="button"
          className={t.id === activeId ? styles.terminalInstanceTabActive : styles.terminalInstanceTab}
          onClick={() => setActiveId(t.id)}
        >
          {t.title}
          {i > 0 && (
            <span
              className={styles.terminalInstanceTabClose}
              onClick={(e) => { e.stopPropagation(); removeTerminal(t.id); }}
            >
              <X size={9} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function TaskOutputPanel() {
  const { panelHeight, collapsed, toggleCollapse, handleMouseDown, activeTab } = useTaskOutputPanelStore(
    useShallow((s) => ({
      panelHeight: s.panelHeight,
      collapsed: s.collapsed,
      toggleCollapse: s.toggleCollapse,
      handleMouseDown: s.handleMouseDown,
      activeTab: s.activeTab,
    })),
  );
  const setActiveTab = useTaskOutputPanelStore((s) => s.setActiveTab);
  const clearCompleted = useTaskOutputPanelStore((s) => s.clearCompleted);
  const contentRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const { agentInstanceId } = useParams<{ agentInstanceId?: string }>();
  const projectTasks = useTasksForProject(projectId, agentInstanceId);
  useActiveTaskTracking();

  const hasActiveTasks = projectTasks.some((t) => t.status === "active");
  const hasCompleted = projectTasks.some((t) => t.status !== "active");

  const handleContentScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    stickToBottom.current =
      el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  };

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    stickToBottom.current = true;
    el.scrollTop = el.scrollHeight;

    const observer = new MutationObserver(() => {
      if (stickToBottom.current) {
        bottomRef.current?.scrollIntoView({ block: "end" });
      }
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [activeTab]);

  return (
    <div
      className={collapsed ? styles.panelCollapsed : styles.panel}
      style={{ height: collapsed ? 30 : panelHeight }}
    >
      <div data-resize-handle className={styles.resizeHandle} onMouseDown={collapsed ? undefined : handleMouseDown} />
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Item.Chevron expanded={!collapsed} onToggle={toggleCollapse} size="sm" />
          <PanelTabs activeTab={activeTab} onTabChange={setActiveTab} isRunning={hasActiveTasks} />
        </div>
        <div className={styles.headerActions}>
          {projectId && <AutomationControls projectId={projectId} />}
          {activeTab === "run" && hasCompleted && (
            <button
              type="button"
              className={styles.headerBtn}
              onClick={clearCompleted}
              title="Clear completed"
              aria-label="Clear completed task output"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {activeTab === "run" && (
        <div className={styles.content} ref={contentRef} onScroll={handleContentScroll}>
          {projectTasks.length === 0 ? (
            <div className={styles.emptyState}>
              <Text size="sm" className={styles.emptyText}>No tasks</Text>
            </div>
          ) : (
            projectTasks.map((entry) =>
              entry.status === "active" ? (
                <ActiveTaskStream
                  key={entry.taskId}
                  taskId={entry.taskId}
                  title={entry.title}
                />
              ) : (
                <CompletedTaskOutput
                  key={entry.taskId}
                  taskId={entry.taskId}
                  projectId={entry.projectId}
                  title={entry.title}
                  status={entry.status}
                />
              ),
            )
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {activeTab === "terminal" && (
        <div className={styles.terminalContent}>
          <TerminalInstanceTabs />
          <TerminalPanelBody embedded />
        </div>
      )}
    </div>
  );
}
