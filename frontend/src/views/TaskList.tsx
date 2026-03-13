import { useEffect, useState, useMemo } from "react";
import { api } from "../api/client";
import type { Spec, Task } from "../types";
import { StatusBadge } from "../components/StatusBadge";
import { useProjectContext } from "../context/ProjectContext";
import { useSidekick } from "../context/SidekickContext";
import { Page, PageEmptyState, Group, Item, Text } from "@cypher-asi/zui";
import { ListTodo } from "lucide-react";

function TaskRow({ task, expanded, onToggle }: { task: Task; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <Item onClick={onToggle} hasChildren expanded={expanded}>
        <Item.Icon>
          <Text variant="muted" size="xs" as="span">#{task.order_index}</Text>
        </Item.Icon>
        <Item.Label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
            <StatusBadge status={task.status} />
            <span>{task.title}</span>
          </span>
        </Item.Label>
        <Item.Chevron expanded={expanded} onToggle={onToggle} />
      </Item>
      {expanded && (
        <div style={{ padding: "var(--space-2) var(--space-4) var(--space-3) var(--space-8)", fontSize: "var(--text-sm)", color: "var(--color-text-muted)", lineHeight: 1.6 }}>
          <p>{task.description}</p>
          {task.execution_notes && (
            <p style={{ marginTop: "var(--space-2)", color: "var(--color-text-muted)" }}>
              <strong>Notes:</strong> {task.execution_notes}
            </p>
          )}
        </div>
      )}
    </>
  );
}

export function TaskList() {
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const sidekick = useSidekick();
  const [localSpecs, setLocalSpecs] = useState<Spec[]>([]);
  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const specMap = new Map(specs.map((s) => [s.spec_id, s]));
  const groupedTasks = specs.map((spec) => ({
    spec,
    tasks: tasks.filter((t) => t.spec_id === spec.spec_id),
  }));
  const ungrouped = tasks.filter((t) => !specMap.has(t.spec_id));

  return (
    <Page
      title="Tasks"
      subtitle={`${tasks.length} tasks across ${specs.length} specs`}
      isLoading={loading}
    >
      {tasks.length === 0 ? (
        <PageEmptyState
          icon={<ListTodo size={32} />}
          title="No tasks yet"
          description="Tasks are created automatically when specs are generated."
        />
      ) : (
        <>
          {groupedTasks.map(({ spec, tasks: specTasks }) => (
            <Group key={spec.spec_id} label={spec.title} count={specTasks.length}>
              {specTasks.map((task) => (
                <TaskRow
                  key={task.task_id}
                  task={task}
                  expanded={expanded === task.task_id}
                  onToggle={() => setExpanded(expanded === task.task_id ? null : task.task_id)}
                />
              ))}
            </Group>
          ))}
          {ungrouped.length > 0 && (
            <Group label="Other" count={ungrouped.length}>
              {ungrouped.map((task) => (
                <TaskRow
                  key={task.task_id}
                  task={task}
                  expanded={expanded === task.task_id}
                  onToggle={() => setExpanded(expanded === task.task_id ? null : task.task_id)}
                />
              ))}
            </Group>
          )}
        </>
      )}
    </Page>
  );
}
