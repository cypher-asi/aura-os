import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@cypher-asi/zui";
import { tasksApi } from "../../../api/tasks";
import { useKanbanStore } from "../stores/kanban-store";
import { useProjectContext } from "../../../stores/project-action-store";
import styles from "./TasksMainPanel.module.css";

interface AddTaskFormProps {
  projectId: string;
  status: "backlog" | "to_do";
  onDone: () => void;
}

export function AddTaskForm({ projectId, status, onDone }: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const addTask = useKanbanStore((s) => s.addTask);
  const ctx = useProjectContext();
  const specs = ctx?.initialSpecs ?? [];
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
      });
      addTask(projectId, task);
      onDone();
    } catch (err) {
      console.error("Failed to create task:", err);
      setSubmitting(false);
    }
  }, [title, description, submitting, specs, projectId, status, addTask, onDone]);

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
