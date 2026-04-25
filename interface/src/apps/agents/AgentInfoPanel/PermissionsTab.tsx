import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, Toggle } from "@cypher-asi/zui";
import { AlertTriangle, Check, Loader2, Plus, ShieldCheck, X } from "lucide-react";
import { api } from "../../../api/client";
import type {
  AgentInstalledToolsDiagnostic,
  InstalledToolDiagnosticRow,
} from "../../../api/agents";
import { getApiErrorMessage } from "../../../utils/api-errors";
import { useAgentStore } from "../stores";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useOrgStore } from "../../../stores/org-store";
import type { Agent } from "../../../shared/types";
import {
  emptyAgentPermissions,
  type AgentPermissions,
  type AgentScope,
  type Capability,
} from "../../../shared/types/permissions-wire";
import {
  CAPABILITY_LABELS,
  GLOBAL_CAPABILITY_TYPES,
  hasAllCoreCapabilities,
  hasUniverseScope,
  isProjectScopedCapabilityType,
  isSuperAgent,
} from "../../../shared/types/permissions";
import styles from "./AgentInfoPanel.module.css";

interface PermissionsTabProps {
  agent: Agent;
  isOwnAgent: boolean;
}

type ScopeAxis = "orgs" | "projects" | "agent_ids";

function shortenId(id: string): string {
  if (id.length <= 9) return id;
  return `${id.slice(0, 8)}…`;
}

function sortedScope(scope: AgentScope): AgentScope {
  return {
    orgs: [...scope.orgs].sort(),
    projects: [...scope.projects].sort(),
    agent_ids: [...scope.agent_ids].sort(),
  };
}

function capabilityKey(cap: Capability): string {
  if (cap.type === "readProject" || cap.type === "writeProject") {
    return `${cap.type}:${cap.id}`;
  }
  return cap.type;
}

function sortedCapabilities(caps: Capability[]): Capability[] {
  return [...caps].sort((a, b) => capabilityKey(a).localeCompare(capabilityKey(b)));
}

function permissionsEqual(
  a: AgentPermissions | undefined,
  b: AgentPermissions | undefined,
): boolean {
  const aa = a ?? emptyAgentPermissions();
  const bb = b ?? emptyAgentPermissions();
  const sa = sortedScope(aa.scope);
  const sb = sortedScope(bb.scope);
  if (
    sa.orgs.length !== sb.orgs.length ||
    sa.projects.length !== sb.projects.length ||
    sa.agent_ids.length !== sb.agent_ids.length
  ) {
    return false;
  }
  for (let i = 0; i < sa.orgs.length; i++) if (sa.orgs[i] !== sb.orgs[i]) return false;
  for (let i = 0; i < sa.projects.length; i++)
    if (sa.projects[i] !== sb.projects[i]) return false;
  for (let i = 0; i < sa.agent_ids.length; i++)
    if (sa.agent_ids[i] !== sb.agent_ids[i]) return false;
  const ca = sortedCapabilities(aa.capabilities).map(capabilityKey);
  const cb = sortedCapabilities(bb.capabilities).map(capabilityKey);
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
  return true;
}

/**
 * Subtle inline indicator that echoes the autosave lifecycle: spinner
 * while a PUT is in flight, a check-mark for a brief "Saved" flash,
 * and a red error label with a retry affordance when the last save
 * failed. Rendered in the Scope section header because it's the
 * first section the user's eye lands on — not in the Capabilities
 * header, even though that's where most toggles live, so scope edits
 * don't feel silently un-saved.
 */
function AutosaveStatus({
  status,
  onRetry,
}: {
  status:
    | { kind: "idle" }
    | { kind: "saving" }
    | { kind: "saved" }
    | { kind: "error"; message: string };
  onRetry: () => void;
}) {
  if (status.kind === "idle") {
    return null;
  }
  if (status.kind === "saving") {
    return (
      <span className={styles.permsAutosaveStatus} aria-live="polite">
        <Loader2 size={12} className={styles.permsAutosaveSpinner} />
        <span>Saving…</span>
      </span>
    );
  }
  if (status.kind === "saved") {
    return (
      <span
        className={`${styles.permsAutosaveStatus} ${styles.permsAutosaveStatusSaved}`}
        aria-live="polite"
      >
        <Check size={12} />
        <span>Saved</span>
      </span>
    );
  }
  return (
    <span
      className={`${styles.permsAutosaveStatus} ${styles.permsAutosaveStatusError}`}
      role="alert"
    >
      <AlertTriangle size={12} />
      <span title={status.message}>Save failed</span>
      <button
        type="button"
        className={styles.permsAutosaveRetry}
        onClick={onRetry}
      >
        Retry
      </button>
    </span>
  );
}

/**
 * Friendly label for each `InstalledToolDiagnosticRow.source` bucket.
 * Kept out of `CAPABILITY_LABELS` because it applies to rows that are
 * *not* tied to a capability (workspace tools, integrations).
 */
const SOURCE_GROUP_LABELS: Record<
  InstalledToolDiagnosticRow["source"],
  string
> = {
  workspace: "Workspace tools",
  integration: "Integrations",
};

/**
 * Group diagnostic rows for display. Current server diagnostics only emit
 * workspace and integration sources; legacy cross-agent dispatcher rows were
 * removed with the harness migration.
 */
function groupDiagnosticRows(
  rows: InstalledToolDiagnosticRow[],
): { key: string; label: string; rows: InstalledToolDiagnosticRow[] }[] {
  const groups = new Map<
    string,
    { key: string; label: string; rows: InstalledToolDiagnosticRow[] }
  >();
  for (const row of rows) {
    const groupKey = `src:${row.source}`;
    const label = SOURCE_GROUP_LABELS[row.source];
    let entry = groups.get(groupKey);
    if (!entry) {
      entry = { key: groupKey, label, rows: [] };
      groups.set(groupKey, entry);
    }
    entry.rows.push(row);
  }
  return Array.from(groups.values());
}

interface ActiveHarnessToolsSectionProps {
  agentId: string;
  /**
   * Bumped by callers after `onSave` persists permission changes so the
   * diagnostic refetches against the now-authoritative agent record.
   */
  refreshKey: number;
}

/**
 * Read-only diagnostic that shows the exact `installed_tools` list the
 * server would ship to the harness for this agent, including whether the
 * in-process dispatcher actually has a handler for each name. Surfaces
 * wiring gaps (for example a capability that emits a `spawn_agent` tool
 * name when the dispatcher only knows `create_agent`).
 */
function ActiveHarnessToolsSection({
  agentId,
  refreshKey,
}: ActiveHarnessToolsSectionProps) {
  const [data, setData] = useState<AgentInstalledToolsDiagnostic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    api.agents
      .getInstalledTools(agentId, { signal: controller.signal })
      .then((result) => {
        setData(result);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [agentId, refreshKey]);

  const groups = useMemo(
    () => (data ? groupDiagnosticRows(data.tools) : []),
    [data],
  );

  return (
    <div className={styles.section}>
      <div className={styles.permsSectionHeader}>
        <span className={styles.permsSectionTitle}>Active harness tools</span>
      </div>
      {loading && !data && (
        <span className={styles.permsEmpty}>Loading tools…</span>
      )}
      {error && <span className={styles.permsSaveError}>{error}</span>}
      {data && data.missing_registrations.length > 0 && (
        <div className={styles.permsToolsWarning} role="alert">
          <AlertTriangle size={14} className={styles.permsToolsWarningIcon} />
          <div>
            <Text size="xs" weight="medium">
              Unregistered cross-agent tool
              {data.missing_registrations.length > 1 ? "s" : ""}:{" "}
              {data.missing_registrations.join(", ")}
            </Text>
            <Text size="xs" variant="muted">
              These legacy names are not available through the current
              harness-delegated tool surface, so calls to them will fail.
            </Text>
          </div>
        </div>
      )}
      {data && data.tools.length === 0 && !loading && !error && (
        <span className={styles.permsEmpty}>
          No tools installed for this agent.
        </span>
      )}
      {groups.map((group) => (
        <div key={group.key} className={styles.permsToolsGroup}>
          <div className={styles.permsToolsGroupHeader}>{group.label}</div>
          {group.rows.map((row) => {
            const isMissing = !row.registered;
            return (
              <div
                key={`${row.source}:${row.name}`}
                className={styles.permsToolsRow}
              >
                <span
                  className={`${styles.permsToolsStatusDot} ${
                    isMissing
                      ? styles.permsToolsStatusDotMissing
                      : styles.permsToolsStatusDotOk
                  }`}
                  title={
                    isMissing
                      ? "Installed but no matching handler is registered in the dispatcher."
                      : "Registered with the dispatcher."
                  }
                />
                <span
                  className={`${styles.permsToolsName} ${
                    isMissing ? styles.permsToolsNameMissing : ""
                  }`}
                  title={row.endpoint}
                >
                  {row.name}
                </span>
                <span className={styles.permsToolsBadge}>
                  {row.source.replace("_", " ")}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  handler: () => void,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, handler, enabled]);
}

interface ScopeChipProps {
  id: string;
  name?: string;
  canEdit: boolean;
  onRemove: () => void;
}

function ScopeChip({ id, name, canEdit, onRemove }: ScopeChipProps) {
  return (
    <span className={styles.permsChip}>
      <span className={styles.permsChipText} title={name ?? id}>
        {name ?? shortenId(id)}
      </span>
      {canEdit && (
        <button
          type="button"
          className={styles.permsChipRemove}
          onClick={onRemove}
          aria-label="Remove"
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

interface ScopeRowPickerProps {
  axis: ScopeAxis;
  current: string[];
  onAdd: (id: string) => void;
  onClose: () => void;
}

function ScopeRowPicker({ axis, current, onAdd, onClose }: ScopeRowPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, true);
  const projects = useProjectsListStore((s) => s.projects);
  const agents = useAgentStore((s) => s.agents);
  const orgs = useOrgStore((s) => s.orgs);
  const currentSet = useMemo(() => new Set(current), [current]);

  let options: { id: string; name: string }[] = [];
  if (axis === "projects") {
    options = projects.map((p) => ({ id: p.project_id, name: p.name }));
  } else if (axis === "agent_ids") {
    options = agents.map((a) => ({ id: a.agent_id, name: a.name }));
  } else if (axis === "orgs") {
    options = orgs.map((o) => ({ id: o.org_id, name: o.name }));
  }

  const available = options.filter((o) => !currentSet.has(o.id));

  return (
    <div ref={ref} className={styles.permsPicker}>
      {available.length === 0 ? (
        <div className={styles.permsPickerEmpty}>
          {axis === "orgs" && orgs.length === 0
            ? "No orgs available"
            : "Nothing to add"}
        </div>
      ) : (
        available.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className={styles.permsPickerItem}
            onClick={() => {
              onAdd(opt.id);
              onClose();
            }}
          >
            {opt.name}
          </button>
        ))
      )}
    </div>
  );
}

interface ScopeRowProps {
  label: string;
  axis: ScopeAxis;
  ids: string[];
  canEdit: boolean;
  nameFor: (id: string) => string | undefined;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
}

function ScopeRow({
  label,
  axis,
  ids,
  canEdit,
  nameFor,
  onAdd,
  onRemove,
}: ScopeRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className={styles.permsScopeRow}>
      <div className={styles.permsScopeRowHeader}>
        <span className={styles.permsScopeLabel}>{label}</span>
        {canEdit && (
          <div className={styles.permsPickerWrapper}>
            <button
              type="button"
              className={styles.permsAddButton}
              onClick={() => setPickerOpen((v) => !v)}
              aria-label={`Add ${label}`}
            >
              <Plus size={12} />
            </button>
            {pickerOpen && (
              <ScopeRowPicker
                axis={axis}
                current={ids}
                onAdd={onAdd}
                onClose={() => setPickerOpen(false)}
              />
            )}
          </div>
        )}
      </div>
      <div className={styles.permsChipRow}>
        {ids.length === 0 ? (
          <span className={styles.permsEmpty}>None</span>
        ) : (
          ids.map((id) => (
            <ScopeChip
              key={id}
              id={id}
              name={nameFor(id)}
              canEdit={canEdit}
              onRemove={() => onRemove(id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ProjectAccessPickerProps {
  excludeIds: Set<string>;
  onPick: (projectId: string) => void;
  onClose: () => void;
}

function ProjectAccessPicker({
  excludeIds,
  onPick,
  onClose,
}: ProjectAccessPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, true);
  const projects = useProjectsListStore((s) => s.projects);
  const available = projects.filter((p) => !excludeIds.has(p.project_id));

  return (
    <div ref={ref} className={styles.permsPicker}>
      {available.length === 0 ? (
        <div className={styles.permsPickerEmpty}>No projects available</div>
      ) : (
        available.map((p) => (
          <button
            key={p.project_id}
            type="button"
            className={styles.permsPickerItem}
            onClick={() => {
              onPick(p.project_id);
              onClose();
            }}
          >
            {p.name}
          </button>
        ))
      )}
    </div>
  );
}

interface ProjectAccessModePickerProps {
  onPick: (mode: "read" | "write" | "both") => void;
  onClose: () => void;
}

function ProjectAccessModePicker({
  onPick,
  onClose,
}: ProjectAccessModePickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, onClose, true);
  return (
    <div ref={ref} className={styles.permsPicker}>
      <button
        type="button"
        className={styles.permsPickerItem}
        onClick={() => {
          onPick("read");
          onClose();
        }}
      >
        Read
      </button>
      <button
        type="button"
        className={styles.permsPickerItem}
        onClick={() => {
          onPick("write");
          onClose();
        }}
      >
        Write
      </button>
      <button
        type="button"
        className={styles.permsPickerItem}
        onClick={() => {
          onPick("both");
          onClose();
        }}
      >
        Both
      </button>
    </div>
  );
}

/**
 * Debounce window between a toggle flip and the PUT that persists it.
 * Keeps the save count proportional to what the user did — rapid
 * on/off flicker coalesces into a single request — without making the
 * "saved" indicator feel sluggish.
 */
const AUTOSAVE_DEBOUNCE_MS = 350;
/**
 * How long the transient "Saved" badge stays visible after a
 * successful autosave before fading back to the idle state.
 */
const SAVED_INDICATOR_MS = 1500;

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function PermissionsTab({ agent, isOwnAgent }: PermissionsTabProps) {
  const initial = useMemo<AgentPermissions>(
    () => agent.permissions ?? emptyAgentPermissions(),
    // `agent.permissions` is only read on first render / agent switch;
    // subsequent edits flow through the local `draft` and are persisted
    // via the autosave effect below. We intentionally do NOT resync
    // `draft` from `agent.permissions` on every store patch, because
    // our own successful save patches the store and we'd otherwise
    // clobber any keystrokes the user made while the PUT was in
    // flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent.agent_id],
  );
  const [draft, setDraft] = useState<AgentPermissions>(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [projectPickerStep, setProjectPickerStep] = useState<
    null | { stage: "project" } | { stage: "mode"; projectId: string }
  >(null);
  const [toolsRefreshKey, setToolsRefreshKey] = useState(0);

  // Source of truth for "what the server last confirmed". The autosave
  // effect diffs against this to decide whether a new PUT is warranted.
  // Updated in three places:
  //   1. on agent switch (reset to the freshly-rendered bundle),
  //   2. after a successful PUT (set to the server's echoed bundle),
  //   3. never on external prop changes — see the comment on `initial`.
  const lastSavedRef = useRef<AgentPermissions>(initial);
  // Mirror of the latest `draft` for the unmount/agent-switch flush.
  // Kept in a ref so the flush effect doesn't have to depend on
  // `draft` (which would re-register the cleanup on every keystroke).
  const draftRef = useRef<AgentPermissions>(initial);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const next = agent.permissions ?? emptyAgentPermissions();
    setDraft(next);
    lastSavedRef.current = next;
    draftRef.current = next;
    setStatus({ kind: "idle" });
    // Any debounce / saved-badge timer from the previous agent has no
    // business running against the new one.
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (savedBadgeTimerRef.current !== null) {
      clearTimeout(savedBadgeTimerRef.current);
      savedBadgeTimerRef.current = null;
    }
    // Intentionally keyed on `agent_id` only: we don't want a
    // successful PUT's `patchAgent` round-trip (which mutates
    // `agent.permissions` via the store) to race against pending
    // keystrokes and snap the draft back to a stale snapshot. The
    // autosave effect below keeps `draft` in sync with the server
    // through its own explicit flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.agent_id]);

  const projects = useProjectsListStore((s) => s.projects);
  const agents = useAgentStore((s) => s.agents);
  const orgs = useOrgStore((s) => s.orgs);

  const projectNameFor = useCallback(
    (id: string) => projects.find((p) => p.project_id === id)?.name,
    [projects],
  );
  const agentNameFor = useCallback(
    (id: string) => agents.find((a) => a.agent_id === id)?.name,
    [agents],
  );
  const orgNameFor = useCallback(
    (id: string) => orgs.find((o) => o.org_id === id)?.name,
    [orgs],
  );

  const universeScope = hasUniverseScope(draft);
  const isCeoPreset =
    hasUniverseScope(draft) && hasAllCoreCapabilities(draft);
  const canEdit = isOwnAgent && !isCeoPreset;

  const globalEnabled = useMemo(() => {
    const set = new Set(draft.capabilities.map((c) => c.type));
    return set;
  }, [draft.capabilities]);

  const projectAccessByProject = useMemo(() => {
    const map = new Map<string, { read: boolean; write: boolean }>();
    for (const cap of draft.capabilities) {
      if (cap.type === "readProject") {
        const entry = map.get(cap.id) ?? { read: false, write: false };
        entry.read = true;
        map.set(cap.id, entry);
      } else if (cap.type === "writeProject") {
        const entry = map.get(cap.id) ?? { read: false, write: false };
        entry.write = true;
        map.set(cap.id, entry);
      }
    }
    return map;
  }, [draft.capabilities]);

  const setScope = (axis: ScopeAxis, next: string[]) => {
    setDraft((prev) => ({
      ...prev,
      scope: { ...prev.scope, [axis]: next },
    }));
  };

  const toggleGlobalCapability = (type: Capability["type"]) => {
    setDraft((prev) => {
      const present = prev.capabilities.some((c) => c.type === type);
      if (present) {
        return {
          ...prev,
          capabilities: prev.capabilities.filter((c) => c.type !== type),
        };
      }
      return {
        ...prev,
        capabilities: [...prev.capabilities, { type } as Capability],
      };
    });
  };

  const removeProjectAccess = (projectId: string, mode: "read" | "write") => {
    setDraft((prev) => ({
      ...prev,
      capabilities: prev.capabilities.filter((c) => {
        if (mode === "read" && c.type === "readProject" && c.id === projectId)
          return false;
        if (mode === "write" && c.type === "writeProject" && c.id === projectId)
          return false;
        return true;
      }),
    }));
  };

  const addProjectAccess = (projectId: string, mode: "read" | "write" | "both") => {
    setDraft((prev) => {
      const filtered = prev.capabilities.filter(
        (c) =>
          !(
            (c.type === "readProject" || c.type === "writeProject") &&
            c.id === projectId
          ),
      );
      const existing = prev.capabilities.filter(
        (c) =>
          (c.type === "readProject" || c.type === "writeProject") &&
          c.id === projectId,
      );
      const hadRead = existing.some((c) => c.type === "readProject");
      const hadWrite = existing.some((c) => c.type === "writeProject");
      const wantRead = mode === "read" || mode === "both" || hadRead;
      const wantWrite = mode === "write" || mode === "both" || hadWrite;
      const additions: Capability[] = [];
      if (wantRead) additions.push({ type: "readProject", id: projectId });
      if (wantWrite) additions.push({ type: "writeProject", id: projectId });
      return {
        ...prev,
        capabilities: [...filtered, ...additions],
      };
    });
  };

  const performSave = useCallback(
    async (snapshot: AgentPermissions) => {
      setStatus({ kind: "saving" });
      try {
        const updated = await api.agents.update(agent.agent_id, {
          permissions: snapshot,
        });
        // Adopt the server's echoed bundle as the new "last saved"
        // baseline — falling back to our own snapshot when the
        // response omits `permissions`, which defeats the
        // autosave-loop check the next time the user flips a toggle.
        lastSavedRef.current = updated.permissions ?? snapshot;
        useAgentStore.getState().patchAgent(updated);
        setToolsRefreshKey((k) => k + 1);
        setStatus({ kind: "saved" });
        if (savedBadgeTimerRef.current !== null) {
          clearTimeout(savedBadgeTimerRef.current);
        }
        savedBadgeTimerRef.current = setTimeout(() => {
          savedBadgeTimerRef.current = null;
          // Only drop back to "idle" if nothing else has happened
          // since — avoids blinking away a fresh "Saving…" that
          // arrived between the success and this timeout.
          setStatus((cur) => (cur.kind === "saved" ? { kind: "idle" } : cur));
        }, SAVED_INDICATOR_MS);
      } catch (err) {
        setStatus({ kind: "error", message: getApiErrorMessage(err) });
      }
    },
    [agent.agent_id],
  );

  // Debounced autosave: any time the draft diverges from the last
  // server-confirmed bundle, wait out the debounce window and PUT.
  // Re-triggering the effect (e.g. the user flips another toggle
  // before the timer fires) cancels the pending timer via the cleanup
  // function so rapid flicker coalesces into a single request.
  useEffect(() => {
    if (!canEdit) return;
    if (permissionsEqual(draft, lastSavedRef.current)) return;

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void performSave(draft);
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [draft, canEdit, performSave]);

  // If the user navigates away (unmount) or switches agents while a
  // debounce is still pending, flush the latest draft immediately
  // rather than silently dropping it.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        if (!permissionsEqual(draftRef.current, lastSavedRef.current)) {
          void performSave(draftRef.current);
        }
      }
      if (savedBadgeTimerRef.current !== null) {
        clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = null;
      }
    };
  }, [performSave]);

  const projectCapIds = useMemo(
    () =>
      new Set(
        draft.capabilities
          .filter(
            (c): c is Capability & { id: string } =>
              isProjectScopedCapabilityType(c.type),
          )
          .map((c) => c.id),
      ),
    [draft.capabilities],
  );

  return (
    <>
      {isSuperAgent(agent) && (
        <div className={styles.permsCeoCard}>
          <ShieldCheck size={18} className={styles.permsCeoIcon} />
          <div className={styles.permsCeoBody}>
            <Text size="sm" weight="medium">
              CEO preset — universe scope, every core capability.
            </Text>
            <Text size="xs" variant="muted">
              CEO permissions are locked to prevent self-lockout.
            </Text>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Scope</span>
          {canEdit && (
            <AutosaveStatus
              status={status}
              onRetry={() => {
                if (!permissionsEqual(draft, lastSavedRef.current)) {
                  void performSave(draft);
                }
              }}
            />
          )}
        </div>
        {universeScope ? (
          <div className={styles.permsChipRow}>
            <span className={styles.permsChip}>
              <span className={styles.permsChipText}>
                Universe — every org, project, and agent
              </span>
            </span>
          </div>
        ) : (
          <>
            <ScopeRow
              label="Orgs"
              axis="orgs"
              ids={draft.scope.orgs}
              canEdit={canEdit}
              nameFor={orgNameFor}
              onAdd={(id) => setScope("orgs", [...draft.scope.orgs, id])}
              onRemove={(id) =>
                setScope(
                  "orgs",
                  draft.scope.orgs.filter((x) => x !== id),
                )
              }
            />
            <ScopeRow
              label="Projects"
              axis="projects"
              ids={draft.scope.projects}
              canEdit={canEdit}
              nameFor={projectNameFor}
              onAdd={(id) =>
                setScope("projects", [...draft.scope.projects, id])
              }
              onRemove={(id) =>
                setScope(
                  "projects",
                  draft.scope.projects.filter((x) => x !== id),
                )
              }
            />
            <ScopeRow
              label="Agent IDs"
              axis="agent_ids"
              ids={draft.scope.agent_ids}
              canEdit={canEdit}
              nameFor={agentNameFor}
              onAdd={(id) =>
                setScope("agent_ids", [...draft.scope.agent_ids, id])
              }
              onRemove={(id) =>
                setScope(
                  "agent_ids",
                  draft.scope.agent_ids.filter((x) => x !== id),
                )
              }
            />
          </>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Capabilities</span>
        </div>
        {GLOBAL_CAPABILITY_TYPES.map((type) => {
          const meta = CAPABILITY_LABELS[type];
          const Icon = meta.Icon;
          const checked = globalEnabled.has(type);
          return (
            <div key={type} className={styles.permsCapabilityRow}>
              <Icon size={14} className={styles.permsCapabilityIcon} />
              <div className={styles.permsCapabilityText}>
                <span className={styles.permsCapabilityLabel}>{meta.label}</span>
                <span className={styles.permsCapabilityDescription}>
                  {meta.description}
                </span>
              </div>
              <Toggle
                size="sm"
                checked={checked}
                disabled={!canEdit}
                onChange={() => toggleGlobalCapability(type)}
                aria-label={meta.label}
                className={styles.permsCapabilityToggle}
              />
            </div>
          );
        })}
      </div>

      <ActiveHarnessToolsSection
        agentId={agent.agent_id}
        refreshKey={toolsRefreshKey}
      />

      <div className={styles.section}>
        <div className={styles.permsSectionHeader}>
          <span className={styles.permsSectionTitle}>Project access</span>
          {canEdit && (
            <div className={styles.permsPickerWrapper}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setProjectPickerStep({ stage: "project" })}
              >
                Add project access
              </Button>
              {projectPickerStep?.stage === "project" && (
                <ProjectAccessPicker
                  excludeIds={projectCapIds}
                  onPick={(projectId) =>
                    setProjectPickerStep({ stage: "mode", projectId })
                  }
                  onClose={() => setProjectPickerStep(null)}
                />
              )}
              {projectPickerStep?.stage === "mode" && (
                <ProjectAccessModePicker
                  onPick={(mode) => {
                    addProjectAccess(projectPickerStep.projectId, mode);
                    setProjectPickerStep(null);
                  }}
                  onClose={() => setProjectPickerStep(null)}
                />
              )}
            </div>
          )}
        </div>
        {projectAccessByProject.size === 0 ? (
          <span className={styles.permsEmpty}>No project access granted</span>
        ) : (
          Array.from(projectAccessByProject.entries()).map(
            ([projectId, access]) => (
              <div key={projectId} className={styles.permsProjectGroup}>
                <span
                  className={styles.permsProjectName}
                  title={projectId}
                >
                  {projectNameFor(projectId) ?? shortenId(projectId)}
                </span>
                <div className={styles.permsProjectBadges}>
                  {access.read && (
                    <span className={styles.permsChip}>
                      <span className={styles.permsChipText}>Read</span>
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.permsChipRemove}
                          onClick={() => removeProjectAccess(projectId, "read")}
                          aria-label="Remove read access"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  )}
                  {access.write && (
                    <span className={styles.permsChip}>
                      <span className={styles.permsChipText}>Write</span>
                      {canEdit && (
                        <button
                          type="button"
                          className={styles.permsChipRemove}
                          onClick={() => removeProjectAccess(projectId, "write")}
                          aria-label="Remove write access"
                        >
                          <X size={10} />
                        </button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ),
          )
        )}
      </div>

    </>
  );
}
