import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "../../api/client";
import type { Spec } from "../../types";
import type { AuraEvent } from "../../types/aura-events";
import { EventType } from "../../types/aura-events";
import { useEventStore } from "../../stores/event-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { mergeById, compareSpecs } from "../../utils/collections";
import { filterExplorerNodes } from "../../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../../components/EmptyState";
import type { ExplorerNode } from "@cypher-asi/zui";

export function SpecList({ searchQuery }: { searchQuery: string }) {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const subscribe = useEventStore((s) => s.subscribe);
  const { specs, deletedSpecIds, streamingAgentInstanceId } = useSidekickStore(
    useShallow((s) => ({
      specs: s.specs,
      deletedSpecIds: s.deletedSpecIds,
      streamingAgentInstanceId: s.streamingAgentInstanceId,
    })),
  );
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const viewSpec = useSidekickStore((s) => s.viewSpec);
  const sidekickRef = useRef(useSidekickStore.getState());
  const ctxRef = useRef(ctx);

  useEffect(() => useSidekickStore.subscribe((s) => { sidekickRef.current = s; }), []);
  useEffect(() => { ctxRef.current = ctx; }, [ctx]);

  useEffect(() => {
    if (ctx?.initialSpecs) {
      setLocalSpecs(ctx.initialSpecs);
    }
  }, [ctx?.initialSpecs]);
  const mergedSpecs = useMemo(() => {
    const merged = mergeById(localSpecs, specs, "spec_id").sort(compareSpecs);
    if (deletedSpecIds.length === 0) return merged;
    const deleted = new Set(deletedSpecIds);
    return merged.filter((s) => !deleted.has(s.spec_id));
  }, [localSpecs, specs, deletedSpecIds]);

  const fetchSpecs = useCallback(
    (autoSelect?: boolean) => {
      if (!projectId) return;
      api
        .listSpecs(projectId)
        .then((s) => {
          const sorted = s.sort(compareSpecs);
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
      subscribe(EventType.SpecGenStarted, (e: AuraEvent) => {
        if (e.project_id === projectId) {
          setLocalSpecs([]);
          setSelectedId(null);
          sidekickRef.current.clearDeletedSpecs();
        }
      }),
      subscribe(EventType.SpecSaved, (e) => {
        const spec = e.content.spec;
        if (e.project_id === projectId && spec) {
          setLocalSpecs((prev) => {
            if (prev.some((s) => s.spec_id === spec.spec_id)) return prev;
            return [...prev, spec].sort(compareSpecs);
          });
        }
      }),
      subscribe(EventType.SpecGenCompleted, (e: AuraEvent) => {
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

  const defaultExpandedIds = useMemo(() => ["__specs_root__"], []);

  const defaultSelectedIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  );

  const handleSelect = (ids: string[]) => {
    const id = [...ids].reverse().find((candidate) => candidate === "__specs_root__" || specById.has(candidate));
    if (!id) return;
    if (id === "__specs_root__") {
      setSelectedId(id);
      pushPreview({ kind: "specs_overview", specs: mergedSpecs });
      return;
    }
    const spec = specById.get(id);
    if (spec) {
      setSelectedId(id);
      viewSpec(spec);
    }
  };

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const isEmpty = mergedSpecs.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, streamingAgentInstanceId ? 800 : 0);

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
