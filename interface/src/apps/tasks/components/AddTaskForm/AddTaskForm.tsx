import { useState, useCallback, useMemo } from "react";
import { Modal, Button, Toggle, Spinner } from "@cypher-asi/zui";
import { useModalInitialFocus } from "../../../../hooks/use-modal-initial-focus";
import { tasksApi } from "../../../../shared/api/tasks";
import { useKanbanStore } from "../../stores/kanban-store";
import { useProjectActions } from "../../../../stores/project-action-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { useSidekickStore } from "../../../../stores/sidekick-store";
import { Select } from "../../../../components/Select";
import type { Task } from "../../../../shared/types";
import styles from "./AddTaskForm.module.css";

const STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "to_do", label: "To Do" },
];

interface AddTaskFormProps {
  isOpen: boolean;
  projectId: string;
  status: "backlog" | "to_do";
  agentInstanceId?: string;
  onDone: () => void;
  onStatusChange: (status: "backlog" | "to_do") => void;
}

export function AddTaskForm({
  isOpen,
  projectId,
  status,
  agentInstanceId,
  onDone,
  onStatusChange,
}: AddTaskFormProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState(agentInstanceId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [createMore, setCreateMore] = useState(false);
  const addTask = useKanbanStore((s) => s.addTask);
  const removeTask = useKanbanStore((s) => s.removeTask);
  const replaceTask = useKanbanStore((s) => s.replaceTask);
  const ctx = useProjectActions();
  const specs = ctx?.initialSpecs ?? [];
  const projectAgents = useProjectsListStore((s) => s.agentsByProject[projectId]) ?? [];
  const pushSidekickTask = useSidekickStore((s) => s.pushTask);
  const removeSidekickTask = useSidekickStore((s) => s.removeTask);

  const assigneeOptions = useMemo(
    () => [
      { value: "", label: "Unassigned" },
      ...projectAgents.map((a) => ({ value: a.agent_instance_id, label: a.name })),
    ],
    [projectAgents],
  );

  const { inputRef, initialFocusRef } = useModalInitialFocus<HTMLInputElement>();

  const resetForm = useCallback(() => {
    setTitle("");
    setDescription("");
    setAssignee(agentInstanceId ?? "");
    setSubmitting(false);
  }, [agentInstanceId]);

  const handleClose = useCallback(() => {
    resetForm();
    onDone();
  }, [resetForm, onDone]);

  const handleSubmit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed || submitting) return;
    if (specs.length === 0) return;

    const optimisticTaskId = `pending-task-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const optimisticTask: Task = {
      task_id: optimisticTaskId,
      project_id: projectId,
      spec_id: specs[0].spec_id,
      title: trimmed,
      description: description.trim(),
      status,
      order_index: Date.now(),
      dependency_ids: [],
      parent_task_id: null,
      assigned_agent_instance_id: assignee || null,
      completed_by_agent_instance_id: null,
      session_id: null,
      execution_notes: "",
      files_changed: [],
      live_output: "",
      total_input_tokens: 0,
      total_output_tokens: 0,
      created_at: now,
      updated_at: now,
    };

    setSubmitting(true);
    addTask(projectId, optimisticTask);
    pushSidekickTask(optimisticTask);
    try {
      const task = await tasksApi.createTask(projectId, {
        title: trimmed,
        spec_id: specs[0].spec_id,
        description: description.trim() || undefined,
        status,
        assigned_agent_instance_id: assignee || undefined,
      });
      replaceTask(projectId, optimisticTaskId, task);
      removeSidekickTask(optimisticTaskId);
      pushSidekickTask(task);
      const { track } = await import("../../../../lib/analytics");
      track("task_created");
      if (createMore) {
        resetForm();
        inputRef.current?.focus();
      } else {
        handleClose();
      }
    } catch (err) {
      removeTask(projectId, optimisticTaskId);
      removeSidekickTask(optimisticTaskId);
      console.error("Failed to create task:", err);
      setSubmitting(false);
    }
  }, [
    title,
    submitting,
    specs,
    projectId,
    description,
    status,
    assignee,
    addTask,
    pushSidekickTask,
    replaceTask,
    removeSidekickTask,
    createMore,
    resetForm,
    inputRef,
    handleClose,
    removeTask,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="New Task"
      size="md"
      initialFocusRef={initialFocusRef}
      noPadding
      footer={
        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Select
              className={styles.statusPill}
              value={status}
              onChange={(v) => onStatusChange(v as "backlog" | "to_do")}
              disabled={submitting}
              options={STATUS_OPTIONS}
            />
            {projectAgents.length > 0 && (
              <Select
                className={styles.assigneePill}
                value={assignee}
                onChange={setAssignee}
                disabled={submitting}
                placeholder="Unassigned"
                options={assigneeOptions}
              />
            )}
          </div>
          <div className={styles.footerRight}>
            <Toggle
              size="sm"
              label="Create more"
              labelPosition="left"
              checked={createMore}
              onChange={(e) => setCreateMore(e.target.checked)}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={!title.trim() || submitting || specs.length === 0}
            >
              {submitting ? <><Spinner size="sm" /> Creating...</> : "Create Task"}
            </Button>
          </div>
        </div>
      }
    >
      <div className={styles.body} onKeyDown={handleKeyDown}>
        <input
          ref={inputRef}
          className={styles.titleInput}
          placeholder="Task title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
        />
        <textarea
          className={styles.descriptionInput}
          placeholder="Add description..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          disabled={submitting}
        />
      </div>
    </Modal>
  );
}
