import { useEffect } from "react";
import { cn } from "@cypher-asi/zui";
import { useTerminal, type UseTerminalReturn } from "../../hooks/use-terminal";
import { useTerminalPanel } from "../../stores/terminal-panel-store";
import { XTerminal } from "../XTerminal";
import styles from "../TerminalPanel/TerminalPanel.module.css";

function TerminalWrapper({
  visible,
  focused,
  cwd,
  remoteAgentId,
  onHook,
}: {
  visible: boolean;
  focused: boolean;
  cwd?: string;
  remoteAgentId?: string;
  onHook: (hook: UseTerminalReturn) => void;
}) {
  const hook = useTerminal({ cwd, remoteAgentId });

  useEffect(() => {
    onHook(hook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hook.terminalId]);

  return <XTerminal terminal={hook} visible={visible} focused={focused} />;
}

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
    remoteAgentId,
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
        {terminals.map((t) => {
          const isActive = t.id === activeId;
          return (
            <TerminalWrapper
              key={t.id}
              visible={isActive}
              focused={isActive && !collapsed && contentReady}
              cwd={cwd}
              remoteAgentId={remoteAgentId}
              onHook={(hook) => registerHook(t.id, hook)}
            />
          );
        })}
      </div>
    </div>
  );
}
