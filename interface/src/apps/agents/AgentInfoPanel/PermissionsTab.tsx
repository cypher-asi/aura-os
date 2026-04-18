import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, Toggle } from "@cypher-asi/zui";
import { Plus, ShieldCheck, X } from "lucide-react";
import { api } from "../../../api/client";
import { getApiErrorMessage } from "../../../utils/api-errors";
import { useAgentStore } from "../stores";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useOrgStore } from "../../../stores/org-store";
import type { Agent } from "../../../types";
import {
  emptyAgentPermissions,
  type AgentPermissions,
  type AgentScope,
  type Capability,
} from "../../../types/permissions-wire";
import {
  CAPABILITY_LABELS,
  GLOBAL_CAPABILITY_TYPES,
  hasAllCoreCapabilities,
  hasUniverseScope,
  isProjectScopedCapabilityType,
  isSuperAgent,
} from "../../../types/permissions";
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

export function PermissionsTab({ agent, isOwnAgent }: PermissionsTabProps) {
  const initial = useMemo<AgentPermissions>(
    () => agent.permissions ?? emptyAgentPermissions(),
    [agent.permissions],
  );
  const [draft, setDraft] = useState<AgentPermissions>(initial);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [projectPickerStep, setProjectPickerStep] = useState<
    null | { stage: "project" } | { stage: "mode"; projectId: string }
  >(null);

  useEffect(() => {
    setDraft(agent.permissions ?? emptyAgentPermissions());
    setSaveError(null);
  }, [agent.agent_id, agent.permissions]);

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
  const dirty = !permissionsEqual(draft, agent.permissions);

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

  const onDiscard = () => {
    setDraft(agent.permissions ?? emptyAgentPermissions());
    setSaveError(null);
  };

  const onSave = async () => {
    if (!canEdit || !dirty) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.agents.update(agent.agent_id, {
        permissions: draft,
      });
      useAgentStore.getState().patchAgent(updated);
    } catch (err) {
      setSaveError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

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
              />
            </div>
          );
        })}
      </div>

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

      {canEdit && dirty && (
        <div className={styles.permsSaveBar}>
          {saveError && (
            <span className={styles.permsSaveError}>{saveError}</span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onDiscard}
            disabled={saving}
          >
            Discard
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              void onSave();
            }}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </>
  );
}
