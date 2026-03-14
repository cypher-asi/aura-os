import { useState, useCallback, useRef, useEffect } from "react";
import { Plus, X, ChevronDown, ChevronUp } from "lucide-react";
import { useTerminal, type UseTerminalReturn } from "../hooks/use-terminal";
import { XTerminal } from "./XTerminal";
import styles from "./TerminalPanel.module.css";

const STORAGE_KEY = "aura-terminal-panel";
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const HEADER_HEIGHT = 32;

interface TerminalInstance {
  id: string;
  title: string;
  hook: UseTerminalReturn;
}

function TerminalTab({
  instance,
  active,
  onSelect,
  onClose,
}: {
  instance: TerminalInstance;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  return (
    <button
      className={active ? styles.terminalTabActive : styles.terminalTab}
      onClick={onSelect}
    >
      {instance.title}
      <span
        className={styles.tabClose}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <X size={10} />
      </span>
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

function loadPanelState(): { height: number; collapsed: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { height: DEFAULT_HEIGHT, collapsed: true };
}

function savePanelState(height: number, collapsed: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ height, collapsed }));
  } catch { /* ignore */ }
}

export function TerminalPanel({ cwd }: { cwd?: string } = {}) {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const hookRefs = useRef<Map<string, UseTerminalReturn>>(new Map());
  const nextNum = useRef(1);

  const initial = useRef(loadPanelState());
  const [panelHeight, setPanelHeight] = useState(initial.current.height);
  const [collapsed, setCollapsed] = useState(initial.current.collapsed);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  useEffect(() => {
    savePanelState(panelHeight, collapsed);
  }, [panelHeight, collapsed]);

  const addTerminal = useCallback(() => {
    const num = nextNum.current++;
    const key = `term-${Date.now()}-${num}`;
    const instance: TerminalInstance = {
      id: key,
      title: `Terminal ${num}`,
      hook: null!,
    };
    setTerminals((prev) => [...prev, instance]);
    setActiveId(key);
    if (collapsed) setCollapsed(false);
  }, [collapsed]);

  const removeTerminal = useCallback(
    (id: string) => {
      const hook = hookRefs.current.get(id);
      if (hook) {
        hook.kill();
        hookRefs.current.delete(id);
      }
      setTerminals((prev) => {
        const next = prev.filter((t) => t.id !== id);
        if (activeId === id) {
          setActiveId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeId],
  );

  const registerHook = useCallback((id: string, hook: UseTerminalReturn) => {
    hookRefs.current.set(id, hook);
    setTerminals((prev) =>
      prev.map((t) => (t.id === id ? { ...t, hook } : t)),
    );
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startHeight.current = panelHeight;

      const onMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = startY.current - ev.clientY;
        const newHeight = Math.min(
          MAX_HEIGHT,
          Math.max(MIN_HEIGHT, startHeight.current + delta),
        );
        setPanelHeight(newHeight);
      };

      const onUp = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [panelHeight],
  );

  // Auto-create first terminal on mount
  useEffect(() => {
    if (terminals.length === 0) {
      addTerminal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  return (
    <div
      className={styles.terminalPanel}
      style={{ height: collapsed ? HEADER_HEIGHT : panelHeight }}
    >
      {!collapsed && (
        <div
          className={`${styles.resizeHandle} ${dragging.current ? styles.resizeHandleActive : ""}`}
          onMouseDown={handleMouseDown}
        />
      )}

      <div className={styles.terminalHeader}>
        <span className={styles.headerLabel}>Terminal</span>
        <div className={styles.tabList}>
          {terminals.map((t) => (
            <TerminalTab
              key={t.id}
              instance={t}
              active={t.id === activeId}
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

      {!collapsed && (
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
      )}
    </div>
  );
}
