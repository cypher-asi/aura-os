import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api/client";
import type { Sprint } from "../types";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { Explorer, PageEmptyState, Button, ButtonPlus } from "@cypher-asi/zui";
import type { ExplorerNode, DropPosition } from "@cypher-asi/zui";
import { Zap, Plus } from "lucide-react";
import { formatRelativeTime } from "../utils/format";
import styles from "./SprintList.module.css";

export function SprintList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sidekick = useSidekick();

  const fetchSprints = useCallback(() => {
    if (!projectId) return;
    api
      .listSprints(projectId)
      .then((s) => {
        setSprints(s.sort((a, b) => a.order_index - b.order_index));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchSprints();
  }, [fetchSprints]);

  useEffect(() => {
    return sidekick.onSprintUpdate((updated) => {
      setSprints((prev) =>
        prev.map((s) =>
          s.sprint_id === updated.sprint_id ? { ...s, ...updated } : s,
        ),
      );
    });
  }, [sidekick]);

  const sprintById = useMemo(
    () => new Map(sprints.map((s) => [s.sprint_id, s])),
    [sprints],
  );

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      sprints.map((sprint) => ({
        id: sprint.sprint_id,
        label: sprint.title,
        suffix: (
          <span className={styles.sprintTime}>
            {formatRelativeTime(sprint.created_at)}
          </span>
        ),
        metadata: { type: "sprint" },
      })),
    [sprints],
  );

  const handleSelect = (ids: string[]) => {
    const id = ids[0];
    if (!id) return;
    const sprint = sprintById.get(id);
    if (sprint) {
      setSelectedId(id);
      sidekick.viewSprint(sprint);
    }
  };

  const handleAdd = async () => {
    if (!projectId) return;
    try {
      const sprint = await api.createSprint(projectId, "Untitled Sprint");
      setSprints((prev) => [...prev, sprint]);
      setSelectedId(sprint.sprint_id);
      sidekick.viewSprint(sprint);
    } catch (err) {
      console.error("Failed to create sprint", err);
    }
  };

  const handleDrop = async (draggedId: string, targetId: string, position: DropPosition) => {
    const ordered = [...sprints];
    const dragIdx = ordered.findIndex((s) => s.sprint_id === draggedId);
    let targetIdx = ordered.findIndex((s) => s.sprint_id === targetId);
    if (dragIdx === -1 || targetIdx === -1) return;

    const [dragged] = ordered.splice(dragIdx, 1);
    if (position === "after") targetIdx += 1;
    if (dragIdx < targetIdx) targetIdx -= 1;
    ordered.splice(targetIdx, 0, dragged);

    const reordered = ordered.map((s, i) => ({ ...s, order_index: i }));
    setSprints(reordered);

    if (!projectId) return;
    try {
      await api.reorderSprints(
        projectId,
        reordered.map((s) => s.sprint_id),
      );
    } catch (err) {
      console.error("Failed to reorder sprints", err);
      fetchSprints();
    }
  };

  const isEmpty = sprints.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading);

  if (isEmpty) {
    if (!showEmpty) return null;
    return (
      <div className={styles.emptyWrap}>
        <PageEmptyState
          icon={<Zap size={32} />}
          title="No sprints yet"
          description="Create a sprint to organize your project work."
        />
        <div className={styles.addButtonCenter}>
          <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={handleAdd}>
            Add Sprint
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sprintListWrap}>
      <div className={styles.addButton}>
        <ButtonPlus onClick={handleAdd} size="sm" title="Add Sprint" />
      </div>
      <Explorer
        data={explorerData}
        searchable
        searchPlaceholder="Search"
        enableDragDrop={true}
        enableMultiSelect={false}
        defaultSelectedIds={selectedId ? [selectedId] : undefined}
        onSelect={handleSelect}
        onDrop={handleDrop}
      />
    </div>
  );
}
