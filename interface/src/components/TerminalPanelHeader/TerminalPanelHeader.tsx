import { type MouseEvent } from "react";
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { useTerminalPanel, type TerminalInstance } from "../../stores/terminal-panel-store";
import styles from "../TerminalPanel/TerminalPanel.module.css";

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
