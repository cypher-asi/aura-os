import { useEffect, useMemo, useRef, useState } from "react";
import { Text } from "@cypher-asi/zui";
import { AlertTriangle, Check, Loader2, Plus, X } from "lucide-react";
import { api } from "../../../../api/client";
import type {
  AgentInstalledToolsDiagnostic,
  InstalledToolDiagnosticRow,
} from "../../../../shared/api/agents";
import { getApiErrorMessage } from "../../../../shared/utils/api-errors";
import { useAgentStore } from "../../stores";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useOrgStore } from "../../../../stores/org-store";
import styles from "../AgentInfoPanel.module.css";
import { shortenId, type SaveStatus, type ScopeAxis } from "./permissions-utils";

/**
 * Subtle inline indicator that echoes the autosave lifecycle: spinner
 * while a PUT is in flight, a check-mark for a brief "Saved" flash,
 * and a red error label with a retry affordance when the last save
 * failed. Rendered in the Scope section header because it's the
 * first section the user's eye lands on — not in the Capabilities
 * header, even though that's where most toggles live, so scope edits
 * don't feel silently un-saved.
 */
export function AutosaveStatus({
  status,
  onRetry,
}: {
  status: SaveStatus;
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
export function ActiveHarnessToolsSection({
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

export function ScopeChip({ id, name, canEdit, onRemove }: ScopeChipProps) {
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

export function ScopeRow({
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

export function ProjectAccessPicker({
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

export function ProjectAccessModePicker({
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
