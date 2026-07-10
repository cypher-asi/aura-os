import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, FileText, Clock, GitBranch, RefreshCw, Brain, Check, Pin, ShieldCheck } from "lucide-react";
import { api, ApiClientError } from "../../../api/client";
import { useIsStreaming } from "../../../hooks/stream/hooks";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import {
  SidekickList,
  type SidekickListSection,
} from "../../../components/SidekickList";
import { EmptyState } from "../../../components/EmptyState";
import type {
  Agent,
  AgentContinuityConfig,
  MemoryFact,
  MemoryContinuity,
  MemoryProcedure,
  MemoryRetrievalTrace,
  MemorySnapshot,
} from "../../../shared/types";
import { track } from "../../../lib/analytics";
import panelStyles from "./AgentInfoPanel.module.css";
import styles from "./MemoryTab.module.css";

type MemoryFilter = "all" | "facts" | "events" | "procedures";
type MemoryError = "connection" | "unknown" | null;
type MemoryKind = "fact" | "event" | "procedure";
interface MemoryTarget {
  kind: MemoryKind;
  id: string;
}

function parseRowId(rowId: string): MemoryTarget | null {
  const sep = rowId.indexOf(":");
  if (sep === -1) return null;
  const kind = rowId.slice(0, sep);
  const id = rowId.slice(sep + 1);
  if (kind === "fact" || kind === "event" || kind === "procedure") {
    return { kind, id };
  }
  return null;
}

interface MemoryTabProps {
  agent: Agent;
}

const DEFAULT_CONTINUITY_CONFIG: AgentContinuityConfig = {
  use_memory: true,
  generate_memory: true,
  write_policy: "automatic",
  retrieval_mode: "query_aware",
  allow_user_scope: false,
  allow_workspace_scope: false,
};

const DEFAULT_MEMORY_CONTINUITY: MemoryContinuity = {
  scope: "agent",
  status: "active",
  sensitivity: "normal",
  pinned: false,
  provenance: {},
};

function normalizeSnapshot(snapshot: MemorySnapshot): MemorySnapshot {
  return {
    ...snapshot,
    facts: (snapshot.facts ?? []).map((fact) => ({
      ...fact,
      continuity: fact.continuity ?? DEFAULT_MEMORY_CONTINUITY,
    })),
    events: (snapshot.events ?? []).map((event) => ({
      ...event,
      continuity: event.continuity ?? DEFAULT_MEMORY_CONTINUITY,
    })),
    procedures: (snapshot.procedures ?? []).map((procedure) => ({
      ...procedure,
      continuity: procedure.continuity ?? DEFAULT_MEMORY_CONTINUITY,
    })),
  };
}

export function MemoryTab({ agent }: MemoryTabProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MemoryError>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [config, setConfig] = useState<AgentContinuityConfig>(DEFAULT_CONTINUITY_CONFIG);
  const [trace, setTrace] = useState<MemoryRetrievalTrace | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const { viewMemoryFact, viewMemoryEvent, viewMemoryProcedure } = useAgentSidekickStore();

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    let cancelled = false;
    const configRequest = typeof api.memory.getContinuityConfig === "function"
      ? api.memory.getContinuityConfig(agent.agent_id).catch(() => DEFAULT_CONTINUITY_CONFIG)
      : Promise.resolve(DEFAULT_CONTINUITY_CONFIG);
    const traceRequest = typeof api.memory.getLatestRetrievalTrace === "function"
      ? api.memory.getLatestRetrievalTrace(agent.agent_id).catch(() => null)
      : Promise.resolve(null);
    Promise.all([
      api.memory.getSnapshot(agent.agent_id),
      configRequest,
      traceRequest,
    ])
      .then(([data, nextConfig, nextTrace]) => {
        if (!cancelled) {
          setSnapshot(normalizeSnapshot(data));
          setConfig(nextConfig);
          setTrace(nextTrace);
          if (nextTrace) {
            track("memory_retrieval_viewed", {
              selected_count: nextTrace.selected_count,
              query_aware: nextTrace.query_aware,
            });
          }
        }
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

  const softRefresh = useCallback(() => {
    let cancelled = false;
    const traceRequest = typeof api.memory.getLatestRetrievalTrace === "function"
      ? api.memory.getLatestRetrievalTrace(agent.agent_id).catch(() => null)
      : Promise.resolve(null);
    Promise.all([
      api.memory.getSnapshot(agent.agent_id),
      traceRequest,
    ])
      .then(([data, nextTrace]) => {
        if (!cancelled) {
          setSnapshot(normalizeSnapshot(data));
          setTrace(nextTrace);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load: the effect kicks off the snapshot fetch (which flips loading/snapshot), and returns its cancellation cleanup
    return fetchMemory();
  }, [fetchMemory]);

  const isStreaming = useIsStreaming(agent.agent_id);
  const prevStreamingRef = useRef(isStreaming);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming) {
      const timer = setTimeout(() => softRefresh(), 1500);
      return () => clearTimeout(timer);
    }
  }, [isStreaming, softRefresh]);

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
      track("memory_deleted", { kind: target.kind });
    } catch {
      // silent — row stays if delete fails
    }
  }, [agent.agent_id]);

  const updateContinuityConfig = useCallback(async (
    patch: Partial<AgentContinuityConfig>,
  ) => {
    const next = { ...config, ...patch };
    setConfig(next);
    setSavingConfig(true);
    try {
      const saved = await api.memory.updateContinuityConfig(agent.agent_id, next);
      setConfig(saved);
      track("memory_continuity_updated", {
        use_memory: saved.use_memory,
        generate_memory: saved.generate_memory,
        write_policy: saved.write_policy,
        retrieval_mode: saved.retrieval_mode,
      });
    } catch {
      setConfig(config);
    } finally {
      setSavingConfig(false);
    }
  }, [agent.agent_id, config]);

  const toggleFactPin = useCallback(async (fact: MemoryFact) => {
    const continuity = { ...fact.continuity, pinned: !fact.continuity.pinned };
    const updated = await api.memory.updateFact(agent.agent_id, fact.fact_id, {
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
      importance: fact.importance,
      source: fact.source,
      continuity,
    });
    setSnapshot((current) => current ? {
      ...current,
      facts: current.facts.map((item) => item.fact_id === updated.fact_id ? updated : item),
    } : current);
    track("memory_pinned", { kind: "fact", pinned: continuity.pinned });
  }, [agent.agent_id]);

  const toggleProcedurePin = useCallback(async (procedure: MemoryProcedure) => {
    const continuity = {
      ...procedure.continuity,
      pinned: !procedure.continuity.pinned,
    };
    const updated = await api.memory.updateProcedure(
      agent.agent_id,
      procedure.procedure_id,
      {
        name: procedure.name,
        trigger: procedure.trigger,
        steps: procedure.steps,
        context_constraints: procedure.context_constraints,
        skill_name: procedure.skill_name,
        skill_relevance: procedure.skill_relevance,
        continuity,
      },
    );
    setSnapshot((current) => current ? {
      ...current,
      procedures: current.procedures.map((item) =>
        item.procedure_id === updated.procedure_id ? updated : item),
    } : current);
    track("memory_pinned", { kind: "procedure", pinned: continuity.pinned });
  }, [agent.agent_id]);

  const approveFact = useCallback(async (fact: MemoryFact) => {
    const updated = await api.memory.updateFact(agent.agent_id, fact.fact_id, {
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
      importance: fact.importance,
      source: fact.source,
      continuity: { ...fact.continuity, status: "active" },
    });
    setSnapshot((current) => current ? {
      ...current,
      facts: current.facts.map((item) => item.fact_id === updated.fact_id ? updated : item),
    } : current);
    track("memory_corrected", { kind: "fact" });
  }, [agent.agent_id]);

  const approveProcedure = useCallback(async (procedure: MemoryProcedure) => {
    const updated = await api.memory.updateProcedure(
      agent.agent_id,
      procedure.procedure_id,
      {
        name: procedure.name,
        trigger: procedure.trigger,
        steps: procedure.steps,
        context_constraints: procedure.context_constraints,
        skill_name: procedure.skill_name,
        skill_relevance: procedure.skill_relevance,
        continuity: { ...procedure.continuity, status: "active" },
      },
    );
    setSnapshot((current) => current ? {
      ...current,
      procedures: current.procedures.map((item) =>
        item.procedure_id === updated.procedure_id ? updated : item),
    } : current);
    track("memory_corrected", { kind: "procedure" });
  }, [agent.agent_id]);

  const handleMenuAction = useCallback(
    (actionId: string, rowId: string) => {
      if (actionId !== "delete") return;
      const target = parseRowId(rowId);
      if (target) void handleDeleteMemory(target);
    },
    [handleDeleteMemory],
  );

  const counts = useMemo(() => {
    if (!snapshot) return { facts: 0, events: 0, procedures: 0 };
    return {
      facts: snapshot.facts?.length ?? 0,
      events: snapshot.events?.length ?? 0,
      procedures: snapshot.procedures?.length ?? 0,
    };
  }, [snapshot]);

  const sections = useMemo<SidekickListSection[]>(() => {
    if (!snapshot) return [];
    const out: SidekickListSection[] = [];
    if (filter === "all" || filter === "facts") {
      out.push({
        id: "facts",
        label: `Facts (${counts.facts})`,
        emptyLabel: "No facts yet",
        rows: (snapshot.facts ?? []).map((fact) => ({
          id: `fact:${fact.fact_id}`,
          icon: <FileText size={13} />,
          label: fact.key,
          detail: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
          suffix: (
            <span className={styles.badge} data-status={fact.continuity.status}>
              {fact.continuity.status === "active"
                ? `${Math.round(fact.confidence * 100)}%`
                : fact.continuity.status}
            </span>
          ),
          trailingAction: (
            <button
              type="button"
              className={`${styles.pinButton}${fact.continuity.pinned ? ` ${styles.pinButtonActive}` : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                if (fact.continuity.status === "pending") {
                  void approveFact(fact);
                } else {
                  void toggleFactPin(fact);
                }
              }}
              title={fact.continuity.status === "pending"
                ? "Approve memory"
                : fact.continuity.pinned ? "Unpin memory" : "Pin memory"}
              aria-label={fact.continuity.status === "pending"
                ? "Approve memory"
                : fact.continuity.pinned ? "Unpin memory" : "Pin memory"}
            >
              {fact.continuity.status === "pending" ? <Check size={12} /> : <Pin size={12} />}
            </button>
          ),
          onSelect: () => viewMemoryFact(fact),
        })),
      });
    }
    if (filter === "all" || filter === "events") {
      out.push({
        id: "events",
        label: `Events (${counts.events})`,
        emptyLabel: "No events yet",
        rows: (snapshot.events ?? []).map((event) => ({
          id: `event:${event.event_id}`,
          icon: <Clock size={13} />,
          label: event.event_type,
          detail: event.summary,
          suffix: <span className={styles.badge}>{new Date(event.timestamp).toLocaleDateString()}</span>,
          onSelect: () => viewMemoryEvent(event),
        })),
      });
    }
    if (filter === "all" || filter === "procedures") {
      out.push({
        id: "procedures",
        label: `Procedures (${counts.procedures})`,
        emptyLabel: "No procedures yet",
        rows: (snapshot.procedures ?? []).map((proc) => ({
          id: `procedure:${proc.procedure_id}`,
          icon: <GitBranch size={13} />,
          label: proc.name,
          detail: `${proc.steps.length} steps${proc.skill_name ? ` · ${proc.skill_name}` : ""}`,
          suffix: <span className={styles.badge}>{Math.round(proc.success_rate * 100)}%</span>,
          trailingAction: (
            <button
              type="button"
              className={`${styles.pinButton}${proc.continuity.pinned ? ` ${styles.pinButtonActive}` : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                if (proc.continuity.status === "pending") {
                  void approveProcedure(proc);
                } else {
                  void toggleProcedurePin(proc);
                }
              }}
              title={proc.continuity.status === "pending"
                ? "Approve procedure"
                : proc.continuity.pinned ? "Unpin procedure" : "Pin procedure"}
              aria-label={proc.continuity.status === "pending"
                ? "Approve procedure"
                : proc.continuity.pinned ? "Unpin procedure" : "Pin procedure"}
            >
              {proc.continuity.status === "pending" ? <Check size={12} /> : <Pin size={12} />}
            </button>
          ),
          onSelect: () => viewMemoryProcedure(proc),
        })),
      });
    }
    return out;
  }, [
    snapshot,
    filter,
    counts,
    viewMemoryFact,
    viewMemoryEvent,
    viewMemoryProcedure,
    toggleFactPin,
    toggleProcedurePin,
    approveFact,
    approveProcedure,
  ]);

  if (loading) {
    return (
      <div className={panelStyles.tabEmptyState}>
        <Loader2 size={16} className={panelStyles.spin} /> Loading memory...
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.errorState}>
        <span>{error === "connection" ? "Could not connect to harness" : "Failed to load memory"}</span>
        <button type="button" className={styles.retryButton} onClick={fetchMemory}>
          <RefreshCw size={12} /> Retry
        </button>
      </div>
    );
  }

  const filters: { id: MemoryFilter; label: string; count: number }[] = [
    { id: "all", label: "All", count: counts.facts + counts.events + counts.procedures },
    { id: "facts", label: "Facts", count: counts.facts },
    { id: "events", label: "Events", count: counts.events },
    { id: "procedures", label: "Procedures", count: counts.procedures },
  ];

  return (
    <>
      <section className={styles.continuityCard} data-testid="continuity-controls">
        <div className={styles.continuityHeader}>
          <span className={styles.continuityIcon}><Brain size={15} /></span>
          <div>
            <strong>Agent Continuity</strong>
            <span>Relevant memory with local provenance and controls</span>
          </div>
          <ShieldCheck size={15} className={styles.privacyIcon} aria-label="Local memory controls" />
        </div>
        <label className={styles.controlRow}>
          <span><strong>Use memory</strong><small>Apply relevant context in future turns</small></span>
          <input
            type="checkbox"
            checked={config.use_memory}
            disabled={savingConfig}
            onChange={(event) => void updateContinuityConfig({ use_memory: event.currentTarget.checked })}
          />
        </label>
        <label className={styles.controlRow}>
          <span><strong>Learn from sessions</strong><small>Extract non-sensitive facts and procedures</small></span>
          <input
            type="checkbox"
            checked={config.generate_memory}
            disabled={savingConfig}
            onChange={(event) => void updateContinuityConfig({ generate_memory: event.currentTarget.checked })}
          />
        </label>
        <div className={styles.selectGrid}>
          <label>
            <span>Write policy</span>
            <select
              value={config.write_policy}
              disabled={savingConfig}
              onChange={(event) => void updateContinuityConfig({
                write_policy: event.currentTarget.value as AgentContinuityConfig["write_policy"],
              })}
            >
              <option value="automatic">Automatic</option>
              <option value="approval">Require approval</option>
              <option value="explicit_only">Explicit only</option>
            </select>
          </label>
          <label>
            <span>Retrieval</span>
            <select
              value={config.retrieval_mode}
              disabled={savingConfig}
              onChange={(event) => void updateContinuityConfig({
                retrieval_mode: event.currentTarget.value as AgentContinuityConfig["retrieval_mode"],
              })}
            >
              <option value="query_aware">Request-aware</option>
              <option value="salience">Importance and recency</option>
            </select>
          </label>
        </div>
        <div className={styles.traceRow} data-testid="continuity-trace">
          {trace ? (
            <>
              <span><strong>{trace.selected_count}</strong> recalled</span>
              <span><strong>{trace.estimated_tokens}</strong> estimated tokens</span>
              <span><strong>{trace.duration_ms} ms</strong> retrieval</span>
              <span>{trace.query_aware ? "Request-aware" : "Salience"}</span>
            </>
          ) : (
            <span>No retrieval evidence yet. Start a new turn to verify continuity.</span>
          )}
        </div>
      </section>
      <div className={styles.filterRow}>
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`${styles.filterChip}${filter === f.id ? ` ${styles.filterChipActive}` : ""}`}
          >
            {f.label} ({f.count})
          </button>
        ))}
      </div>
      <SidekickList
        sections={sections}
        empty={<EmptyState>No memories yet</EmptyState>}
        menuActions={["delete"]}
        onMenuAction={handleMenuAction}
      />
    </>
  );
}
