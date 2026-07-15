import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { Loader2, FileText, Clock, GitBranch, RefreshCw, Brain, Check, Pin, ShieldCheck, Users } from "lucide-react";
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
  MemoryScope,
  MemoryAccessOptions,
} from "../../../shared/types";
import type { AgentProjectBinding } from "../hooks/use-cascade-delete-agent";
import { track } from "../../../lib/analytics";
import panelStyles from "./AgentInfoPanel.module.css";
import styles from "./MemoryTab.module.css";

type MemoryFilter = "all" | "facts" | "events" | "procedures";
type MemoryError = "connection" | "unknown" | null;
type MemoryKind = "fact" | "event" | "procedure";
type ScopeControlValue = MemoryScope | "legacy";
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
  projectBindings?: AgentProjectBinding[];
}

const DEFAULT_CONTINUITY_CONFIG: AgentContinuityConfig = {
  use_memory: true,
  generate_memory: true,
  write_policy: "automatic",
  retrieval_mode: "query_aware",
  allow_user_scope: true,
  allow_project_scope: true,
};

const DEFAULT_MEMORY_CONTINUITY: MemoryContinuity = {
  scope: "agent",
  status: "active",
  sensitivity: "normal",
  pinned: false,
  provenance: {},
};

function normalizeSnapshot(snapshot: MemorySnapshot): MemorySnapshot {
  const normalizeContinuity = (continuity?: MemoryContinuity): MemoryContinuity => {
    const normalized = continuity ?? DEFAULT_MEMORY_CONTINUITY;
    return {
      ...normalized,
      scope: (normalized.scope as string) === "workspace" ? "project" : normalized.scope,
    };
  };
  return {
    ...snapshot,
    facts: (snapshot.facts ?? []).map((fact) => ({
      ...fact,
      continuity: normalizeContinuity(fact.continuity),
    })),
    events: (snapshot.events ?? []).map((event) => ({
      ...event,
      continuity: normalizeContinuity(event.continuity),
    })),
    procedures: (snapshot.procedures ?? []).map((procedure) => ({
      ...procedure,
      continuity: normalizeContinuity(procedure.continuity),
    })),
  };
}

const SCOPE_LABELS: Record<MemoryScope, string> = {
  agent: "This agent",
  project: "Project agents",
  user: "Personal",
};

export function MemoryTab({ agent, projectBindings = [] }: MemoryTabProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<MemoryError>(null);
  const [filter, setFilter] = useState<MemoryFilter>("all");
  const [config, setConfig] = useState<AgentContinuityConfig>(DEFAULT_CONTINUITY_CONFIG);
  const [trace, setTrace] = useState<MemoryRetrievalTrace | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState(projectBindings[0]?.project_id ?? "");
  const [scopeFilter, setScopeFilter] = useState<"all" | MemoryScope>("all");
  const { viewMemoryFact, viewMemoryEvent, viewMemoryProcedure } = useAgentSidekickStore();

  useEffect(() => {
    if (!selectedProjectId && projectBindings[0]?.project_id) {
      setSelectedProjectId(projectBindings[0].project_id);
    } else if (selectedProjectId && !projectBindings.some((binding) => binding.project_id === selectedProjectId)) {
      setSelectedProjectId(projectBindings[0]?.project_id ?? "");
    }
  }, [projectBindings, selectedProjectId]);

  const memoryAccess = useMemo<MemoryAccessOptions>(() => ({
    projectId: selectedProjectId || undefined,
    includeLegacy: true,
  }), [selectedProjectId]);

  const scopeControlValue = useCallback((continuity: MemoryContinuity): ScopeControlValue => {
    if (
      continuity.scope === "agent"
      && !continuity.provenance.project_id
      && !continuity.provenance.user_id
    ) {
      return "legacy";
    }
    return continuity.scope;
  }, []);

  const matchesScopeFilter = useCallback((continuity: MemoryContinuity) => (
    scopeFilter === "all" || scopeControlValue(continuity) === scopeFilter
  ), [scopeControlValue, scopeFilter]);

  const fetchMemory = useCallback(() => {
    setLoading(true);
    setError(null);
    setSnapshot(null);
    let cancelled = false;
    const configRequest = typeof api.memory.getContinuityConfig === "function"
      ? api.memory.getContinuityConfig(agent.agent_id).catch(() => DEFAULT_CONTINUITY_CONFIG)
      : Promise.resolve(DEFAULT_CONTINUITY_CONFIG);
    const traceRequest = typeof api.memory.getLatestRetrievalTrace === "function"
      ? api.memory.getLatestRetrievalTrace(agent.agent_id, memoryAccess).catch(() => null)
      : Promise.resolve(null);
    Promise.all([
      api.memory.getSnapshot(agent.agent_id, memoryAccess),
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
  }, [agent.agent_id, memoryAccess]);

  const softRefresh = useCallback(() => {
    let cancelled = false;
    const traceRequest = typeof api.memory.getLatestRetrievalTrace === "function"
      ? api.memory.getLatestRetrievalTrace(agent.agent_id, memoryAccess).catch(() => null)
      : Promise.resolve(null);
    Promise.all([
      api.memory.getSnapshot(agent.agent_id, memoryAccess),
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
  }, [agent.agent_id, memoryAccess]);

  useEffect(() => {
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
          await api.memory.deleteFact(agent.agent_id, target.id, memoryAccess);
          setSnapshot((prev) => prev ? { ...prev, facts: prev.facts.filter((f) => f.fact_id !== target.id) } : prev);
          break;
        case "event":
          await api.memory.deleteEvent(agent.agent_id, target.id, memoryAccess);
          setSnapshot((prev) => prev ? { ...prev, events: prev.events.filter((e) => e.event_id !== target.id) } : prev);
          break;
        case "procedure":
          await api.memory.deleteProcedure(agent.agent_id, target.id, memoryAccess);
          setSnapshot((prev) => prev ? { ...prev, procedures: prev.procedures.filter((p) => p.procedure_id !== target.id) } : prev);
          break;
      }
      track("memory_deleted", { kind: target.kind });
    } catch {
      // silent — row stays if delete fails
    }
  }, [agent.agent_id, memoryAccess]);

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
    }, memoryAccess);
    setSnapshot((current) => current ? {
      ...current,
      facts: current.facts.map((item) => item.fact_id === updated.fact_id ? updated : item),
    } : current);
    track("memory_pinned", { kind: "fact", pinned: continuity.pinned });
  }, [agent.agent_id, memoryAccess]);

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
      memoryAccess,
    );
    setSnapshot((current) => current ? {
      ...current,
      procedures: current.procedures.map((item) =>
        item.procedure_id === updated.procedure_id ? updated : item),
    } : current);
    track("memory_pinned", { kind: "procedure", pinned: continuity.pinned });
  }, [agent.agent_id, memoryAccess]);

  const approveFact = useCallback(async (fact: MemoryFact) => {
    const updated = await api.memory.updateFact(agent.agent_id, fact.fact_id, {
      key: fact.key,
      value: fact.value,
      confidence: fact.confidence,
      importance: fact.importance,
      source: fact.source,
      continuity: { ...fact.continuity, status: "active" },
    }, memoryAccess);
    setSnapshot((current) => current ? {
      ...current,
      facts: current.facts.map((item) => item.fact_id === updated.fact_id ? updated : item),
    } : current);
    track("memory_corrected", { kind: "fact" });
  }, [agent.agent_id, memoryAccess]);

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
      memoryAccess,
    );
    setSnapshot((current) => current ? {
      ...current,
      procedures: current.procedures.map((item) =>
        item.procedure_id === updated.procedure_id ? updated : item),
    } : current);
    track("memory_corrected", { kind: "procedure" });
  }, [agent.agent_id, memoryAccess]);

  const moveFact = useCallback(async (fact: MemoryFact, scope: MemoryScope) => {
    const updated = await api.memory.updateFact(agent.agent_id, fact.fact_id, {
      continuity: { ...fact.continuity, scope },
    }, memoryAccess);
    setSnapshot((current) => current ? {
      ...current,
      facts: current.facts.map((item) => item.fact_id === updated.fact_id ? updated : item),
    } : current);
    track("memory_scope_changed", { kind: "fact", scope });
  }, [agent.agent_id, memoryAccess]);

  const moveProcedure = useCallback(async (procedure: MemoryProcedure, scope: MemoryScope) => {
    const updated = await api.memory.updateProcedure(agent.agent_id, procedure.procedure_id, {
      continuity: { ...procedure.continuity, scope },
    }, memoryAccess);
    setSnapshot((current) => current ? {
      ...current,
      procedures: current.procedures.map((item) =>
        item.procedure_id === updated.procedure_id ? updated : item),
    } : current);
    track("memory_scope_changed", { kind: "procedure", scope });
  }, [agent.agent_id, memoryAccess]);

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
        rows: (snapshot.facts ?? [])
          .filter((fact) => matchesScopeFilter(fact.continuity))
          .map((fact) => ({
          id: `fact:${fact.fact_id}`,
          icon: <FileText size={13} />,
          label: fact.key,
          detail: typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value),
          suffix: <span className={styles.scopeBadge}>{scopeControlValue(fact.continuity) === "legacy"
            ? "Legacy"
            : SCOPE_LABELS[fact.continuity.scope]}</span>,
          trailingAction: (
            <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
              <select
                className={styles.scopeSelect}
                value={scopeControlValue(fact.continuity)}
                aria-label={`Memory scope for ${fact.key}`}
                title="Choose who can use this memory"
                onChange={(event) => {
                  const scope = event.currentTarget.value;
                  if (scope !== "legacy") void moveFact(fact, scope as MemoryScope);
                }}
              >
                {scopeControlValue(fact.continuity) === "legacy" && <option value="legacy">Legacy</option>}
                <option value="agent" disabled={!selectedProjectId}>This agent</option>
                <option value="project" disabled={!selectedProjectId}>All agents in this project</option>
                <option value="user">Personal</option>
              </select>
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
            </div>
          ),
          onSelect: () => viewMemoryFact(fact, memoryAccess),
        })),
      });
    }
    if (filter === "all" || filter === "events") {
      out.push({
        id: "events",
        label: `Events (${counts.events})`,
        emptyLabel: "No events yet",
        rows: (snapshot.events ?? [])
          .filter((event) => matchesScopeFilter(event.continuity))
          .map((event) => ({
          id: `event:${event.event_id}`,
          icon: <Clock size={13} />,
          label: event.event_type,
          detail: event.summary,
          suffix: <span className={styles.scopeBadge}>{scopeControlValue(event.continuity) === "legacy"
            ? "Legacy"
            : SCOPE_LABELS[event.continuity.scope]}</span>,
          onSelect: () => viewMemoryEvent(event, memoryAccess),
        })),
      });
    }
    if (filter === "all" || filter === "procedures") {
      out.push({
        id: "procedures",
        label: `Procedures (${counts.procedures})`,
        emptyLabel: "No procedures yet",
        rows: (snapshot.procedures ?? [])
          .filter((proc) => matchesScopeFilter(proc.continuity))
          .map((proc) => ({
          id: `procedure:${proc.procedure_id}`,
          icon: <GitBranch size={13} />,
          label: proc.name,
          detail: `${proc.steps.length} steps${proc.skill_name ? ` · ${proc.skill_name}` : ""}`,
          suffix: <span className={styles.scopeBadge}>{scopeControlValue(proc.continuity) === "legacy"
            ? "Legacy"
            : SCOPE_LABELS[proc.continuity.scope]}</span>,
          trailingAction: (
            <div className={styles.rowActions} onClick={(event) => event.stopPropagation()}>
              <select
                className={styles.scopeSelect}
                value={scopeControlValue(proc.continuity)}
                aria-label={`Memory scope for ${proc.name}`}
                title="Choose who can use this procedure"
                onChange={(event) => {
                  const scope = event.currentTarget.value;
                  if (scope !== "legacy") void moveProcedure(proc, scope as MemoryScope);
                }}
              >
                {scopeControlValue(proc.continuity) === "legacy" && <option value="legacy">Legacy</option>}
                <option value="agent" disabled={!selectedProjectId}>This agent</option>
                <option value="project" disabled={!selectedProjectId}>All agents in this project</option>
                <option value="user">Personal</option>
              </select>
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
            </div>
          ),
          onSelect: () => viewMemoryProcedure(proc, memoryAccess),
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
    moveFact,
    moveProcedure,
    scopeControlValue,
    matchesScopeFilter,
    selectedProjectId,
    memoryAccess,
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
        <div className={styles.brainMap} data-testid="memory-scope-map">
          <Users size={14} />
          <span><strong>Three memory layers</strong><small>Personal everywhere · private to this agent and project · shared with approved project agents</small></span>
        </div>
        {projectBindings.length > 0 ? (
          <label className={styles.projectPicker}>
            <span>Memory available in this project</span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.currentTarget.value)}
              aria-label="Memory available in this project"
            >
              {projectBindings.map((binding) => (
                <option key={binding.project_agent_id} value={binding.project_id}>{binding.project_name}</option>
              ))}
            </select>
          </label>
        ) : (
          <small className={styles.noProjectNote}>This agent has no project binding. Showing personal and legacy memory.</small>
        )}
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
          <span><strong>Personal memory</strong><small>Carry your preferences across projects and agents</small></span>
          <input
            type="checkbox"
            checked={config.allow_user_scope}
            disabled={savingConfig}
            onChange={(event) => void updateContinuityConfig({ allow_user_scope: event.currentTarget.checked })}
          />
        </label>
        <label className={styles.controlRow}>
          <span><strong>Use project-wide memory</strong><small>Include approved context available to every agent in this project</small></span>
          <input
            type="checkbox"
            checked={config.allow_project_scope}
            disabled={savingConfig || !selectedProjectId}
            onChange={(event) => void updateContinuityConfig({ allow_project_scope: event.currentTarget.checked })}
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
      <div className={styles.scopeFilterRow} aria-label="Filter memory by scope">
        {(["all", "agent", "project", "user"] as const).map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => setScopeFilter(scope)}
            className={`${styles.scopeChip}${scopeFilter === scope ? ` ${styles.scopeChipActive}` : ""}`}
          >
            {scope === "all" ? "Every layer" : SCOPE_LABELS[scope]}
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
