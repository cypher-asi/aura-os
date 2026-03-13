import { useEffect, useState, useMemo } from "react";
import { api } from "../api/client";
import type { Spec, Task } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { useProjectContext } from "../context/ProjectContext";
import { useSidekick } from "../context/SidekickContext";
import { Explorer, PageEmptyState, Spinner } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { ListTodo } from "lucide-react";

export function TaskList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [localSpecs, setLocalSpecs] = useState<Spec[]>([]);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([api.listSpecs(projectId), api.listTasks(projectId)])
      .then(([s, t]) => {
        setLocalSpecs(s.sort((a, b) => a.order_index - b.order_index));
        setLocalTasks(t.sort((a, b) => a.order_index - b.order_index));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  const specs = useMemo(() => {
    const map = new Map<string, Spec>();
    for (const s of localSpecs) map.set(s.spec_id, s);
    for (const s of sidekick.specs) map.set(s.spec_id, s);
    return Array.from(map.values()).sort((a, b) => a.order_index - b.order_index);
  }, [localSpecs, sidekick.specs]);

  const tasks = useMemo(() => {
    const map = new Map<string, Task>();
    for (const t of localTasks) map.set(t.task_id, t);
    for (const t of sidekick.tasks) map.set(t.task_id, t);
    return Array.from(map.values()).sort((a, b) => a.order_index - b.order_index);
  }, [localTasks, sidekick.tasks]);

  const specMap = useMemo(() => new Map(specs.map((s) => [s.spec_id, s])), [specs]);

  const groupedTasks = useMemo(
    () =>
      specs.map((spec) => ({
        spec,
        tasks: tasks.filter((t) => t.spec_id === spec.spec_id),
      })),
    [specs, tasks],
  );

  const ungrouped = useMemo(
    () => tasks.filter((t) => !specMap.has(t.spec_id)),
    [tasks, specMap],
  );

  const explorerData: ExplorerNode[] = useMemo(() => {
    const specNodes: ExplorerNode[] = groupedTasks.map(({ spec, tasks: specTasks }) => ({
      id: spec.spec_id,
      label: spec.title,
      children: specTasks.map((task) => ({
        id: task.task_id,
        label: task.title,
        suffix: <StatusBadge status={task.status} />,
        metadata: { type: "task" },
      })),
    }));

    if (ungrouped.length > 0) {
      specNodes.push({
        id: "__other__",
        label: "Other",
        children: ungrouped.map((task) => ({
          id: task.task_id,
          label: task.title,
          suffix: <StatusBadge status={task.status} />,
          metadata: { type: "task" },
        })),
      });
    }

    return specNodes;
  }, [groupedTasks, ungrouped]);

  const defaultExpandedIds = useMemo(
    () => explorerData.map((node) => node.id),
    [explorerData],
  );

  if (loading) {
    return <Spinner />;
  }

  if (tasks.length === 0) {
    return (
      <PageEmptyState
        icon={<ListTodo size={32} />}
        title="No tasks yet"
        description="Tasks are created automatically when specs are generated."
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
      defaultExpandedIds={defaultExpandedIds}
      onSelect={() => {}}
    />
  );
}
