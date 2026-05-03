import { useEffect, useMemo, useRef, useState } from "react";
import {
  fullAccessAgentPermissions,
  type AgentPermissions,
  type Capability,
} from "../../../../shared/types/permissions-wire";
import {
  hasAllCoreCapabilities,
  hasUniverseScope,
  isProjectScopedCapabilityType,
} from "../../../../shared/types/permissions";
import type { Agent } from "../../../../shared/types";
import type { ScopeAxis } from "./permissions-utils";

export interface PermissionsFormHandle {
  draft: AgentPermissions;
  lastSavedRef: React.MutableRefObject<AgentPermissions>;
  draftRef: React.MutableRefObject<AgentPermissions>;
  universeScope: boolean;
  isCeoPreset: boolean;
  canEdit: boolean;
  globalEnabled: Set<Capability["type"]>;
  projectAccessByProject: Map<string, { read: boolean; write: boolean }>;
  projectCapIds: Set<string>;
  setScope: (axis: ScopeAxis, next: string[]) => void;
  toggleGlobalCapability: (type: Capability["type"]) => void;
  removeProjectAccess: (projectId: string, mode: "read" | "write") => void;
  addProjectAccess: (
    projectId: string,
    mode: "read" | "write" | "both",
  ) => void;
}

/**
 * Owns the local edit state for the PermissionsTab form: the working
 * `draft`, the ref-backed `lastSavedRef` baseline that the autosave hook
 * diffs against, derived booleans (universe scope / CEO preset / canEdit)
 * and the per-axis setters that mutate `draft` in place. Resets on
 * agent-id change so we never leak edits across selected agents.
 */
export function usePermissionsForm(
  agent: Agent,
  isOwnAgent: boolean,
): PermissionsFormHandle {
  const initial = useMemo<AgentPermissions>(
    () => agent.permissions ?? fullAccessAgentPermissions(),
    // `agent.permissions` is only read on first render / agent switch;
    // subsequent edits flow through the local `draft` and are persisted
    // via the autosave effect. We intentionally do NOT resync `draft`
    // from `agent.permissions` on every store patch, because our own
    // successful save patches the store and we'd otherwise clobber any
    // keystrokes the user made while the PUT was in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agent.agent_id],
  );
  const [draft, setDraft] = useState<AgentPermissions>(initial);

  // Source of truth for "what the server last confirmed". The autosave
  // hook diffs against this to decide whether a new PUT is warranted.
  const lastSavedRef = useRef<AgentPermissions>(initial);
  // Mirror of the latest `draft` for the unmount/agent-switch flush.
  const draftRef = useRef<AgentPermissions>(initial);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const next = agent.permissions ?? fullAccessAgentPermissions();
    setDraft(next);
    lastSavedRef.current = next;
    draftRef.current = next;
    // Intentionally keyed on `agent_id` only: we don't want a
    // successful PUT's `patchAgent` round-trip (which mutates
    // `agent.permissions` via the store) to race against pending
    // keystrokes and snap the draft back to a stale snapshot. The
    // autosave hook keeps `draft` in sync with the server through its
    // own explicit flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.agent_id]);

  const universeScope = hasUniverseScope(draft);
  const isCeoPreset = hasUniverseScope(draft) && hasAllCoreCapabilities(draft);
  const canEdit = isOwnAgent && !isCeoPreset;

  const globalEnabled = useMemo(() => {
    return new Set(draft.capabilities.map((c) => c.type));
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

  const addProjectAccess = (
    projectId: string,
    mode: "read" | "write" | "both",
  ) => {
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

  return {
    draft,
    lastSavedRef,
    draftRef,
    universeScope,
    isCeoPreset,
    canEdit,
    globalEnabled,
    projectAccessByProject,
    projectCapIds,
    setScope,
    toggleGlobalCapability,
    removeProjectAccess,
    addProjectAccess,
  };
}
