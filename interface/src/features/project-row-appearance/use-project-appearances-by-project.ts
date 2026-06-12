import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useProjectAppearanceStore } from "../../stores/project-appearance-store";
import type { ProjectAppearance } from "../../shared/api/appearance";

/**
 * Subscribe to every project's appearance and return a flattened
 * `Map<projectId, ProjectAppearance>`. Shared across the project-list
 * builders for each app (projects sidebar, tasks, process, …) so any
 * one of them re-renders when any project's appearance changes.
 *
 * Uses `useShallow` on the entries Map so the subscription only
 * triggers when the Map itself flips (the store creates a new Map on
 * every update). Then `useMemo` collapses the entry objects down to
 * just their `.appearance` field — builder code never needs the
 * loading / banner-version flags, so handing it the raw entries
 * would over-share state.
 */
export function useProjectAppearancesByProject(): Map<string, ProjectAppearance> {
  const entries = useProjectAppearanceStore(useShallow((s) => s.entries));
  return useMemo(() => {
    const out = new Map<string, ProjectAppearance>();
    for (const [id, entry] of entries) {
      out.set(id, entry.appearance);
    }
    return out;
  }, [entries]);
}
