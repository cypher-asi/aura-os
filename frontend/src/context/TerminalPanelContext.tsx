import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import type { UseTerminalReturn } from "../hooks/use-terminal";

const STORAGE_KEY = "aura-terminal-panel";
const DEFAULT_HEIGHT = 260;
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;

export interface TerminalInstance {
  id: string;
  title: string;
  hook: UseTerminalReturn;
}

interface TerminalPanelState {
  terminals: TerminalInstance[];
  activeId: string | null;
  panelHeight: number;
  collapsed: boolean;
  cwd?: string;
  addTerminal: () => void;
  removeTerminal: (id: string) => void;
  registerHook: (id: string, hook: UseTerminalReturn) => void;
  setActiveId: (id: string) => void;
  toggleCollapse: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
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

const TerminalPanelContext = createContext<TerminalPanelState | null>(null);

export function TerminalPanelProvider({
  children,
  cwd,
}: {
  children: ReactNode;
  cwd?: string;
}) {
  const [terminals, setTerminals] = useState<TerminalInstance[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const hookRefs = useRef<Map<string, UseTerminalReturn>>(new Map());
  const nextNum = useRef(1);
  const initial = useRef(loadPanelState());
  const [panelHeight, setPanelHeight] = useState(initial.current.height);
  const [collapsed, setCollapsed] = useState(true);
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

  const toggleCollapse = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  useEffect(() => {
    if (terminals.length === 0) {
      const num = nextNum.current++;
      const key = `term-${Date.now()}-${num}`;
      setTerminals([{ id: key, title: `Terminal ${num}`, hook: null! }]);
      setActiveId(key);
    }
  }, [terminals.length]);

  const value: TerminalPanelState = {
    terminals,
    activeId,
    panelHeight,
    collapsed,
    cwd,
    addTerminal,
    removeTerminal,
    registerHook,
    setActiveId,
    toggleCollapse,
    handleMouseDown,
  };

  return (
    <TerminalPanelContext.Provider value={value}>
      {children}
    </TerminalPanelContext.Provider>
  );
}

export function useTerminalPanel() {
  const ctx = useContext(TerminalPanelContext);
  if (!ctx) throw new Error("useTerminalPanel must be used within TerminalPanelProvider");
  return ctx;
}
