import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api/client";
import type { Spec } from "../types";
import type { EngineEvent } from "../types/events";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { Explorer, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { FileText } from "lucide-react";

export function SpecList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [localSpecs, setLocalSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { subscribe } = useEventContext();
  const sidekick = useSidekick();

  const mergedSpecs = useMemo(() => {
    const map = new Map<string, Spec>();
    for (const s of localSpecs) map.set(s.spec_id, s);
    for (const s of sidekick.specs) map.set(s.spec_id, s);
    return Array.from(map.values()).sort((a, b) => a.order_index - b.order_index);
  }, [localSpecs, sidekick.specs]);

  const fetchSpecs = useCallback(
    (autoSelect?: boolean) => {
      if (!projectId) return;
      api
        .listSpecs(projectId)
        .then((s) => {
          const sorted = s.sort((a, b) => a.order_index - b.order_index);
          setLocalSpecs(sorted);
          if (autoSelect && sorted.length > 0) {
            setSelectedId(sorted[0].spec_id);
            sidekick.viewSpec(sorted[0]);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    },
    [projectId, sidekick],
  );

  useEffect(() => {
    fetchSpecs();
  }, [fetchSpecs]);

  useEffect(() => {
    const unsubs = [
      subscribe("spec_gen_started", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setLocalSpecs([]);
          setSelectedId(null);
        }
      }),
      subscribe("spec_saved", (e: EngineEvent) => {
        if (e.project_id === projectId && e.spec) {
          setLocalSpecs((prev) => {
            if (prev.some((s) => s.spec_id === e.spec!.spec_id)) return prev;
            return [...prev, e.spec!].sort((a, b) => a.order_index - b.order_index);
          });
        }
      }),
      subscribe("spec_gen_completed", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          fetchSpecs(true);
        }
      }),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [projectId, subscribe, fetchSpecs]);

  const specById = useMemo(
    () => new Map(mergedSpecs.map((s) => [s.spec_id, s])),
    [mergedSpecs],
  );

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      mergedSpecs.map((spec) => ({
        id: spec.spec_id,
        label: spec.title,
        metadata: { type: "spec" },
      })),
    [mergedSpecs],
  );

  const handleSelect = (ids: string[]) => {
    const id = ids[0];
    if (!id) return;
    const spec = specById.get(id);
    if (spec) {
      setSelectedId(id);
      sidekick.viewSpec(spec);
    }
  };

  const showEmpty = useDelayedEmpty(mergedSpecs.length === 0, loading);

  if (showEmpty) {
    return (
      <PageEmptyState
        icon={<FileText size={32} />}
        title="No specs generated"
        description="Use the chat to generate specs for this project."
      />
    );
  }

  return (
    <Explorer
      data={explorerData}
      searchable
      searchPlaceholder="Search"
      enableDragDrop={false}
      enableMultiSelect={false}
      defaultSelectedIds={selectedId ? [selectedId] : undefined}
      onSelect={handleSelect}
    />
  );
}
