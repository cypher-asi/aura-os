import { useEffect, type MouseEvent } from "react";
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@cypher-asi/zui";
import { useTerminal, type UseTerminalReturn } from "../hooks/use-terminal";
import { useTerminalPanel, type TerminalInstance } from "../context/TerminalPanelContext";
import { XTerminal } from "./XTerminal";
import styles from "./TerminalPanel.module.css";

function TerminalTab({
  instance,
  active,
  canClose,
  onSelect,
  onClose,
}: {
  instance: TerminalInstance;
  active: boolean;
  canClose: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <button
      className={active ? styles.terminalTabActive : styles.terminalTab}
      onClick={onSelect}
    >
      {instance.title}
      {canClose && (
        <span
          className={styles.tabClose}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X size={10} />
        </span>
      )}
    </button>
  );
}

function TerminalWrapper({
  visible,
  cwd,
  onHook,
}: {
  visible: boolean;
  cwd?: string;
  onHook: (hook: UseTerminalReturn) => void;
}) {
  const hook = useTerminal({ cwd });

  useEffect(() => {
    onHook(hook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hook.terminalId]);

  return <XTerminal terminal={hook} visible={visible} />;
}

/** Header bar for embedding in the taskbar row. Sits alongside TaskbarMiddle. */
export function TerminalPanelHeader() {
  const {
    terminals,
    activeId,
    addTerminal,
    removeTerminal,
    setActiveId,
    toggleCollapse,
    collapsed,
  } = useTerminalPanel();

  const handleBackgroundClick = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest("button")) {
      toggleCollapse();
    }
  };

  return (
    <div className={styles.terminalHeaderTaskbar} onClick={handleBackgroundClick}>
      <div className={styles.tabList}>
        {terminals.map((t, i) => (
          <TerminalTab
            key={t.id}
            instance={t}
            active={t.id === activeId}
            canClose={i > 0}
            onSelect={() => setActiveId(t.id)}
            onClose={() => removeTerminal(t.id)}
          />
        ))}
      </div>
      <div className={styles.headerActions}>
        <button
          className={styles.headerBtn}
          onClick={addTerminal}
          title="New terminal"
        >
          <Plus size={14} />
        </button>
        <button
          className={styles.headerBtn}
          onClick={toggleCollapse}
          title={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>
    </div>
  );
}

/** Body (resize handle + terminal content) for the footer. Only visible when expanded. */
export function TerminalPanelBody() {
  const {
    terminals,
    activeId,
    collapsed,
    contentReady,
    panelHeight,
    handleMouseDown,
    registerHook,
    cwd,
  } = useTerminalPanel();

  return (
    <div
      className={cn(
        styles.terminalBodyPanel,
        collapsed && styles.terminalBodyPanelCollapsed,
        !collapsed && contentReady && styles.terminalBodyPanelContentReady,
      )}
      style={{ height: panelHeight }}
    >
      <div
        className={styles.resizeHandle}
        onMouseDown={handleMouseDown}
      />
      <div className={styles.terminalBody}>
        {terminals.map((t) => (
          <TerminalWrapper
            key={t.id}
            visible={t.id === activeId}
            cwd={cwd}
            onHook={(hook) => registerHook(t.id, hook)}
          />
        ))}
      </div>
    </div>
  );
}
