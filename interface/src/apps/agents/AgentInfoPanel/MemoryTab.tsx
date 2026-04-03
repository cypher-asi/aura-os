import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2, FileText, Clock, GitBranch, RefreshCw, Trash2 } from "lucide-react";
import { Menu } from "@cypher-asi/zui";
import type { MenuItem } from "@cypher-asi/zui";
import { api, ApiClientError } from "../../../api/client";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import type { Agent, MemorySnapshot } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

type MemoryFilter = "all" | "facts" | "events" | "procedures";
type MemoryError = "connection" | "unknown" | null;
type MemoryTarget =
  | { kind: "fact"; id: string }
  | { kind: "event"; id: string }
  | { kind: "procedure"; id: string };

interface CtxMenuState {
  x: number;
  y: number;
  target: MemoryTarget;
}

const DELETE_MENU_ITEMS: MenuItem[] = [
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

interface MemoryTabProps {
  agent: Agent;
}

export function MemoryTab({ agent }: MemoryTabProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MemoryError>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const { viewMemoryFact, viewMemoryEvent, viewMemoryProcedure } = useAgentSidekickStore();

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    let cancelled = false;
    api.memory.getSnapshot(agent.agent_id)
      .then((data) => {
        if (!cancelled) setSnapshot(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && err.status === 404) {
          setSnapshot(null);
          return;
        }
        if (err instanceof ApiClientError && err.status === 502) {
          setError("connection");
          return;
        }
        setError("unknown");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  useEffect(() => {
    return fetchMemory();
  }, [fetchMemory]);

  useEffect(() => {
    if (!ctxMenu) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCtxMenu(null);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [ctxMenu]);

  const handleDeleteMemory = useCallback(async (target: MemoryTarget) => {
    try {
      switch (target.kind) {
        case "fact":
          await api.memory.deleteFact(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, facts: prev.facts.filter((f) => f.fact_id !== target.id) } : prev);
          break;
        case "event":
          await api.memory.deleteEvent(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, events: prev.events.filter((e) => e.event_id !== target.id) } : prev);
          break;
        case "procedure":
          await api.memory.deleteProcedure(agent.agent_id, target.id);
          setSnapshot((prev) => prev ? { ...prev, procedures: prev.procedures.filter((p) => p.procedure_id !== target.id) } : prev);
          break;
      }
    } catch {
      // silent — row stays if delete fails
    }
  }, [agent.agent_id]);

  const handleMenuAction = useCallback((actionId: string) => {
    if (actionId === "delete" && ctxMenu) {
      handleDeleteMemory(ctxMenu.target);
    }
    setCtxMenu(null);
  }, [ctxMenu, handleDeleteMemory]);

  const handleContextMenu = useCallback((e: React.MouseEvent, target: MemoryTarget) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, target });
  }, []);

  const counts = useMemo(() => {
    if (!snapshot) return { facts: 0, events: 0, procedures: 0 };
    return {
      facts: snapshot.facts?.length ?? 0,
      events: snapshot.events?.length ?? 0,
      procedures: snapshot.procedures?.length ?? 0,
    };
  }, [snapshot]);

  if (loading) {
    return (
      <div className={styles.tabEmptyState}>
        <Loader2 size={16} className={styles.spin} /> Loading memory...
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.tabEmptyState}>
        <span>{error === "connection" ? "Could not connect to harness" : "Failed to load memory"}</span>
        <button
          type="button"
          onClick={fetchMemory}
          style={{
            marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4,
            padding: "4px 10px", fontSize: 11, borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)", background: "transparent",
            color: "var(--color-text-muted)", cursor: "pointer",
          }}
        >
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  if (!snapshot || (counts.facts === 0 && counts.events === 0 && counts.procedures === 0)) {
    return <div className={styles.tabEmptyState}>No memories yet</div>;
  }

  const filters: { id: MemoryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.facts + counts.events + counts.procedures },
    { id: "facts", label: "Facts", count: counts.facts },
    { id: "events", label: "Events", count: counts.events },
    { id: "procedures", label: "Procedures", count: counts.procedures },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%" }}>
      <div style={{ display: "flex", gap: 2, padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            style={{
              padding: "3px 8px", fontSize: 11, borderRadius: "var(--radius-sm)",
              border: "none", cursor: "pointer",
              background: filter === f.id ? "var(--color-bg-hover, rgba(255,255,255,0.1))" : "transparent",
              color: filter === f.id ? "var(--color-text)" : "var(--color-text-muted)",
              fontWeight: filter === f.id ? 600 : 400,
            }}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {(filter === "all" || filter === "facts") && snapshot.facts?.map((fact) => (
          <MemoryRow
            key={fact.fact_id}
            icon={<FileText size={13} />}
            label={fact.key}
            detail={typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)}
            badge={`${Math.round(fact.confidence * 100)}%`}
            onClick={() => viewMemoryFact(fact)}
            onContextMenu={(e) => handleContextMenu(e, { kind: "fact", id: fact.fact_id })}
          />
        ))}
        {(filter === "all" || filter === "events") && snapshot.events?.map((event) => (
          <MemoryRow
            key={event.event_id}
            icon={<Clock size={13} />}
            label={event.event_type}
            detail={event.summary}
            badge={new Date(event.timestamp).toLocaleDateString()}
            onClick={() => viewMemoryEvent(event)}
            onContextMenu={(e) => handleContextMenu(e, { kind: "event", id: event.event_id })}
          />
        ))}
        {(filter === "all" || filter === "procedures") && snapshot.procedures?.map((proc) => (
          <MemoryRow
            key={proc.procedure_id}
            icon={<GitBranch size={13} />}
            label={proc.name}
            detail={`${proc.steps.length} steps${proc.skill_name ? ` · ${proc.skill_name}` : ""}`}
            badge={`${Math.round(proc.success_rate * 100)}%`}
            onClick={() => viewMemoryProcedure(proc)}
            onContextMenu={(e) => handleContextMenu(e, { kind: "procedure", id: proc.procedure_id })}
          />
        ))}
      </div>

      {ctxMenu &&
        createPortal(
          <div
            ref={ctxMenuRef}
            className={styles.contextMenuOverlay}
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            <Menu
              items={DELETE_MENU_ITEMS}
              onChange={handleMenuAction}
              isOpen
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

function MemoryRow({
  icon,
  label,
  detail,
  badge,
  onClick,
  onContextMenu,
}: {
  icon: React.ReactNode;
  label: string;
  detail: string;
  badge: string;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 12px",
        border: "none", borderBottom: "1px solid var(--color-border)",
        background: "transparent", cursor: "pointer", fontSize: 13,
        color: "var(--color-text)", textAlign: "left", width: "100%",
      }}
      onMouseOver={(e) => { e.currentTarget.style.background = "var(--color-bg-hover, rgba(255,255,255,0.06))"; }}
      onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ flexShrink: 0, opacity: 0.5, display: "flex" }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {detail}
        </div>
      </div>
      <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>{badge}</span>
    </button>
  );
}
