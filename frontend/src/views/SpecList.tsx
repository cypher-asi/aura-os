import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "../api/client";
import type { Spec } from "../types";
import type { EngineEvent } from "../types/events";
import { useEventContext } from "../context/EventContext";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { mergeById } from "../utils/collections";
import { filterExplorerNodes } from "../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../components/EmptyState";
import type { ExplorerNode } from "@cypher-asi/zui";

export function SpecList({ searchQuery }: { searchQuery: string }) {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { subscribe } = useEventContext();
  const sidekick = useSidekick();
  const sidekickRef = useRef(sidekick);
  const ctxRef = useRef(ctx);

  useEffect(() => {
    sidekickRef.current = sidekick;
    ctxRef.current = ctx;
  }, [ctx, sidekick]);
  const mergedSpecs = useMemo(() => {
    const merged = mergeById(localSpecs, sidekick.specs, "spec_id");
    if (sidekick.deletedSpecIds.length === 0) return merged;
    const deleted = new Set(sidekick.deletedSpecIds);
    return merged.filter((s) => !deleted.has(s.spec_id));
  }, [localSpecs, sidekick.specs, sidekick.deletedSpecIds]);

  const fetchSpecs = useCallback(
    (autoSelect?: boolean) => {
      if (!projectId) return;
      api
        .listSpecs(projectId)
        .then((s) => {
          const sorted = s.sort((a, b) => a.order_index - b.order_index);
          setLocalSpecs(sorted);
          sidekickRef.current.clearDeletedSpecs();
          if (autoSelect && sorted.length > 0) {
            setSelectedId(sorted[0].spec_id);
            sidekickRef.current.viewSpec(sorted[0]);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    },
    [projectId],
  );

  useEffect(() => {
    if (!projectId) return;
    fetchSpecs();
  }, [projectId, fetchSpecs]);

  const prevSpecIdsRef = useRef<string>("");
  const specIds = useMemo(() => mergedSpecs.map((s) => s.spec_id).join(","), [mergedSpecs]);
  useEffect(() => {
    const sk = sidekickRef.current;
    if (sk.previewItem?.kind !== "specs_overview") return;
    if (specIds === prevSpecIdsRef.current) return;
    prevSpecIdsRef.current = specIds;
    sk.updatePreviewSpecs(mergedSpecs);
  }, [specIds, mergedSpecs]);

  useEffect(() => {
    const unsubs = [
      subscribe("spec_gen_started", (e: EngineEvent) => {
        if (e.project_id === projectId) {
          setLocalSpecs([]);
          setSelectedId(null);
          sidekickRef.current.clearDeletedSpecs();
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
    () => [
      {
        id: "__specs_root__",
        label: ctx?.project?.specs_title || "Spec",
        children: mergedSpecs.map((spec) => ({
          id: spec.spec_id,
          label: spec.title || "Spec",
          metadata: { type: "spec" },
        })),
      },
    ],
    [mergedSpecs, ctx?.project?.specs_title],
  );

  /* Stable ref - SpecList has single root, avoids ExplorerContext re-merge on sidekick updates */
  const defaultExpandedIds = useMemo(() => ["__specs_root__"], []);

  const defaultSelectedIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  );

  const handleSelect = (ids: string[]) => {
    const id = ids[0];
    if (!id) return;
    if (id === "__specs_root__") {
      setSelectedId(id);
      sidekick.pushPreview({ kind: "specs_overview", specs: mergedSpecs });
      return;
    }
    const spec = specById.get(id);
    if (spec) {
      setSelectedId(id);
      sidekick.viewSpec(spec);
    }
  };

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const isEmpty = mergedSpecs.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, sidekick.streamingAgentInstanceId ? 800 : 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No specs yet</EmptyState>;
  }

  return (
    <>
      <Explorer
        data={filteredData}
        expandOnSelect
        enableDragDrop={false}
        enableMultiSelect={false}
        defaultExpandedIds={defaultExpandedIds}
        defaultSelectedIds={defaultSelectedIds}
        onSelect={handleSelect}
      />
    </>
  );
}
