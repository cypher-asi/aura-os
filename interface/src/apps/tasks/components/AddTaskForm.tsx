import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@cypher-asi/zui";
import { tasksApi } from "../../../api/tasks";
import { useKanbanStore } from "../stores/kanban-store";
import { useProjectContext } from "../../../stores/project-action-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import styles from "./TasksMainPanel.module.css";

interface AddTaskFormProps {
  projectId: string;
  status: "backlog" | "to_do";
  agentInstanceId?: string;
  onDone: () => void;
}

export function AddTaskForm({ projectId, status, agentInstanceId, onDone }: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(agentInstanceId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const addTask = useKanbanStore((s) => s.addTask);
  const ctx = useProjectContext();
  const specs = ctx?.initialSpecs ?? [];
  const projectAgents = useProjectsListStore((s) => s.agentsByProject[projectId] ?? []);
  const formRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (formRef.current && !formRef.current.contains(e.target as Node)) {
        onDone();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onDone]);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    if (specs.length === 0) return;

    setSubmitting(true);
    try {
      const task = await tasksApi.createTask(projectId, {
        title: trimmed,
        spec_id: specs[0].spec_id,
        description: description.trim() || undefined,
        status,
        assigned_agent_instance_id: assignee || undefined,
      });
      addTask(projectId, task);
      onDone();
    } catch (err) {
      console.error("Failed to create task:", err);
      setSubmitting(false);
    }
  }, [title, description, assignee, submitting, specs, projectId, status, addTask, onDone]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      } else if (e.key === "Escape") {
        onDone();
      }
    },
    [handleSubmit, onDone],
  );

  return (
    <div ref={formRef} className={styles.addTaskForm} onKeyDown={handleKeyDown}>
      <input
        ref={inputRef}
        className={styles.addTaskInput}
        placeholder="Task title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={submitting}
      />
      <textarea
        className={styles.addTaskTextarea}
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        disabled={submitting}
      />
      {projectAgents.length > 0 && (
        <select
          className={styles.addTaskSelect}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          disabled={submitting}
        >
          <option value="">Unassigned</option>
          {projectAgents.map((a) => (
            <option key={a.agent_instance_id} value={a.agent_instance_id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <div className={styles.addTaskActions}>
        <Button variant="ghost" size="sm" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
          disabled={!title.trim() || submitting || specs.length === 0}
        >
          {submitting ? "Creating..." : "Create"}
        </Button>
      </div>
    </div>
  );
}
