import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { api } from "../../api/client";
import type { Spec } from "../../shared/types";
import type { AuraEvent } from "../../shared/types/aura-events";
import { EventType } from "../../shared/types/aura-events";
import { useEventStore } from "../../stores/event-store/index";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useShallow } from "zustand/react/shallow";
import { useProjectActions } from "../../stores/project-action-store";
import { useDelayedEmpty } from "../../shared/hooks/use-delayed-empty";
import { mergeById, compareSpecs } from "../../utils/collections";
import { groupSpecsByPlan } from "../../utils/plan-grouping";
import { usePlanStore } from "../../stores/plan-store";
import { filterExplorerNodes } from "../../shared/utils/filterExplorerNodes";
import { EmptyState } from "../../components/EmptyState";
import { ListTree, type ListTreeNode } from "../../components/ListTree";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../components/SidekickItemContextMenu";
import { DeleteSpecModal } from "../../components/DeleteSpecModal";
import { useDeleteSpec, isPendingSpecId } from "../../hooks/use-delete-spec";
import { useRenameSpec } from "../../hooks/use-rename-spec";

export function SpecList({ searchQuery }: { searchQuery: string }) {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const [localSpecs, setLocalSpecs] = useState<Spec[]>(() => ctx?.initialSpecs ?? []);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
  const plansByProject = usePlanStore((s) => s.plansByProject);
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
    const planStore = usePlanStore.getState();
    const unsubs = [
      subscribe(EventType.SpecGenStarted, (e: AuraEvent) => {
        if (e.project_id === projectId) {
          setLocalSpecs([]);
          setSelectedId(null);
          sidekickRef.current.clearDeletedSpecs();
          if (projectId) planStore.beginRun(projectId);
        }
      }),
      subscribe(EventType.SpecSaved, (e) => {
        const spec = e.content.spec;
        if (e.project_id === projectId && spec) {
          if (projectId) planStore.recordSpec(projectId, spec.spec_id);
          setLocalSpecs((prev) => {
            if (prev.some((s) => s.spec_id === spec.spec_id)) return prev;
            return [...prev, spec].sort(compareSpecs);
          });
        }
      }),
      subscribe(EventType.SpecGenCompleted, (e: AuraEvent) => {
        if (e.project_id === projectId) {
          if (projectId) {
            const project = ctxRef.current?.project;
            planStore.finalizeRun(projectId, {
              title: project?.specs_title,
              summary: project?.specs_summary,
            });
          }
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

  const planTitle = ctx?.project?.specs_title || "Plan";
  const plans = useMemo(
    () => (projectId ? plansByProject[projectId] ?? [] : []),
    [plansByProject, projectId],
  );
  const planGroups = useMemo(
    () => groupSpecsByPlan(mergedSpecs, plans, planTitle),
    [mergedSpecs, plans, planTitle],
  );

  const explorerData: ListTreeNode[] = useMemo(
    () =>
      planGroups.map((group) => ({
        id: `plan:${group.plan_id}`,
        label: group.title,
        metadata: { type: "plan" },
        children: [
          {
            id: `summary:${group.plan_id}`,
            label: "Summary",
            metadata: { type: "summary" },
          },
          ...group.specs.map((spec) => ({
            id: spec.spec_id,
            label: spec.title || "Spec",
            metadata: { type: "spec" },
          })),
        ],
      })),
    [planGroups],
  );

  const defaultExpandedIds = useMemo(
    () => planGroups.map((group) => `plan:${group.plan_id}`),
    [planGroups],
  );

  // Keep an open plan overview preview in sync as specs stream in. When a
  // plan node is selected we refresh that group's specs; otherwise we fall
  // back to the full set.
  useEffect(() => {
    const sk = sidekickRef.current;
    if (sk.previewItem?.kind !== "specs_overview") return;
    if (specIds === prevSpecIdsRef.current) return;
    prevSpecIdsRef.current = specIds;
    const sel = selectedId;
    const planId =
      sel?.startsWith("summary:") ? sel.slice("summary:".length)
      : sel?.startsWith("plan:") ? sel.slice("plan:".length)
      : null;
    if (planId) {
      const group = planGroups.find((g) => g.plan_id === planId);
      if (group) {
        sk.updatePreviewSpecs(group.specs);
        return;
      }
    }
    sk.updatePreviewSpecs(mergedSpecs);
  }, [specIds, mergedSpecs, planGroups, selectedId]);

  const defaultSelectedIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  );

  const handleSelect = (node: ListTreeNode) => {
    const id = node.id;
    if (id.startsWith("summary:")) {
      const planId = id.slice("summary:".length);
      const group = planGroups.find((g) => g.plan_id === planId);
      if (!group) return;
      setSelectedId(id);
      pushPreview({
        kind: "specs_overview",
        specs: group.specs,
        title: group.title,
        summary: group.summary,
        planId: group.plan_id,
      });
      return;
    }
    if (id.startsWith("plan:")) {
      // Header click toggles collapse/expand via the Explorer itself; do
      // not open the overview preview here.
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

  const resolveMenuSpec = useCallback(
    (nodeId: string) => {
      const spec = specById.get(nodeId);
      // Suppress the context menu for optimistic `pending-*` rows. They
      // have no server-side identity yet, so neither Rename nor Delete
      // can do anything useful (a Delete would round-trip a bare "Bad
      // Request" from the backend's UUID-only path extractor).
      if (!spec || isPendingSpecId(spec.spec_id)) return null;
      return spec;
    },
    [specById],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } = useSidekickItemContextMenu({
    resolveItem: resolveMenuSpec,
  });

  const {
    deleteTarget,
    setDeleteTarget,
    deleteLoading,
    deleteError,
    handleDelete,
    closeDeleteModal,
  } = useDeleteSpec(projectId);
  const { renameSpec } = useRenameSpec(projectId);

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || !projectId) return;
      if (actionId === "rename") {
        setRenamingId(target.spec_id);
        return;
      }
      if (actionId === "delete") {
        setDeleteTarget(target);
      }
    },
    [menu, closeMenu, projectId, setDeleteTarget],
  );

  const handleRenameCommit = useCallback(
    (nodeId: string, newLabel: string) => {
      setRenamingId(null);
      const spec = specById.get(nodeId);
      if (!spec) return;
      setLocalSpecs((prev) =>
        prev.map((s) => (s.spec_id === nodeId ? { ...s, title: newLabel.trim() } : s)),
      );
      renameSpec(spec, newLabel).catch(() => {
        setLocalSpecs((prev) =>
          prev.map((s) => (s.spec_id === nodeId ? { ...s, title: spec.title } : s)),
        );
      });
    },
    [renameSpec, specById],
  );

  const handleRenameCancel = useCallback(() => {
    setRenamingId(null);
  }, []);

  const isEmpty = mergedSpecs.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, streamingAgentInstanceId ? 800 : 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No plans yet</EmptyState>;
  }

  return (
    <>
      <div onContextMenu={handleContextMenu}>
        <ListTree
          nodes={filteredData}
          expandOnSelect
          indent={0}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedId={defaultSelectedIds[0] ?? null}
          onSelect={handleSelect}
          editingNodeId={renamingId}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={handleRenameCancel}
        />
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
        />
      )}
      <DeleteSpecModal
        target={deleteTarget}
        loading={deleteLoading}
        error={deleteError}
        onClose={closeDeleteModal}
        onDelete={handleDelete}
      />
    </>
  );
}
