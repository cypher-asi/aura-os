import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../../../api/client";
import { getApiErrorMessage } from "../../../../shared/utils/api-errors";
import { useAgentStore } from "../../stores";
import type { AgentPermissions } from "../../../../shared/types/permissions-wire";
import {
  AUTOSAVE_DEBOUNCE_MS,
  SAVED_INDICATOR_MS,
  permissionsEqual,
  type SaveStatus,
} from "./permissions-utils";

interface UsePermissionsAutosaveArgs {
  agentId: string;
  draft: AgentPermissions;
  canEdit: boolean;
  lastSavedRef: React.MutableRefObject<AgentPermissions>;
  draftRef: React.MutableRefObject<AgentPermissions>;
}

export interface PermissionsAutosaveHandle {
  status: SaveStatus;
  toolsRefreshKey: number;
  retry: () => void;
}

/**
 * Drives the debounced PUT-on-edit lifecycle for the permissions form.
 *
 * Watches `draft` against the `lastSavedRef` baseline, schedules a save
 * after `AUTOSAVE_DEBOUNCE_MS`, surfaces the "saving / saved / error"
 * status the header indicator renders, and flushes any pending edit on
 * unmount or agent switch so changes don't get silently dropped.
 */
export function usePermissionsAutosave({
  agentId,
  draft,
  canEdit,
  lastSavedRef,
  draftRef,
}: UsePermissionsAutosaveArgs): PermissionsAutosaveHandle {
  const [status, setStatus] = useState<SaveStatus>({ kind: "idle" });
  const [toolsRefreshKey, setToolsRefreshKey] = useState(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedBadgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
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
    // Reset the autosave indicator on agent switch so a stale "Saved"
    // / "Save failed" badge from the previous selection doesn't bleed
    // into the new one. Mirrors the original combined agent-id effect
    // before the form/autosave split.
    setStatus({ kind: "idle" });
  }, [agentId]);

  const performSave = useCallback(
    async (snapshot: AgentPermissions) => {
      setStatus({ kind: "saving" });
      try {
        const updated = await api.agents.update(agentId, {
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
    [agentId, lastSavedRef],
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
  }, [draft, canEdit, performSave, lastSavedRef]);

  // If the user navigates away (unmount) or switches agents while a
  // debounce is still pending, flush the latest draft immediately
  // rather than silently dropping it. We intentionally read
  // `draftRef.current` / `lastSavedRef.current` at cleanup time so
  // we always send the most recent value the user typed, not a
  // captured snapshot from when the effect was registered.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
        if (!permissionsEqual(draftRef.current, lastSavedRef.current)) {
          // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional latest-value read at unmount
          void performSave(draftRef.current);
        }
      }
      if (savedBadgeTimerRef.current !== null) {
        clearTimeout(savedBadgeTimerRef.current);
        savedBadgeTimerRef.current = null;
      }
    };
  }, [performSave, draftRef, lastSavedRef]);

  const retry = useCallback(() => {
    if (!permissionsEqual(draftRef.current, lastSavedRef.current)) {
      void performSave(draftRef.current);
    }
  }, [performSave, draftRef, lastSavedRef]);

  return { status, toolsRefreshKey, retry };
}
