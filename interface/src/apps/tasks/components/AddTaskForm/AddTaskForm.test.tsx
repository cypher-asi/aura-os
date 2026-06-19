import type { ButtonHTMLAttributes, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import type { ProjectActions } from "../../../../stores/project-action-store";
import { useProjectActionStore } from "../../../../stores/project-action-store";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { tasksApi } from "../../../../shared/api/tasks";
import { emptyAgentPermissions } from "../../../../shared/types/permissions-wire";
import type { AgentInstance, Project, Task } from "../../../../shared/types";
import { AddTaskForm } from "./AddTaskForm";

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title?: string;
    children?: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div role="dialog" aria-label={title}>
        {children}
        {footer}
      </div>
    ) : null,
  Button: ({
    children,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Toggle: ({
    checked,
    label,
    onChange,
  }: {
    checked: boolean;
    label: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  }) => (
    <label>
      {label}
      <input type="checkbox" checked={checked} onChange={onChange} />
    </label>
  ),
  Spinner: () => <span data-testid="spinner" />,
}));

vi.mock("../../../../shared/api/tasks", () => ({
  tasksApi: {
    createTask: vi.fn(),
  },
}));

vi.mock("../../../../lib/analytics", () => ({
  track: vi.fn(),
}));

const project: Project = {
  project_id: "project-1",
  org_id: "org-1",
  name: "Project",
  description: "",
  current_status: "active",
  created_at: "2026-06-19T00:00:00.000Z",
  updated_at: "2026-06-19T00:00:00.000Z",
};

const builderAgent: AgentInstance = {
  agent_id: "agent-template-1",
  agent_instance_id: "agent-1",
  project_id: "project-1",
  name: "Builder",
  role: "Engineer",
  personality: "",
  system_prompt: "",
  skills: [],
  icon: null,
  machine_type: "local",
  adapter_type: "local",
  environment: "desktop",
  status: "idle",
  current_task_id: null,
  current_session_id: null,
  total_input_tokens: 0,
  total_output_tokens: 0,
  permissions: emptyAgentPermissions(),
  created_at: "2026-06-19T00:00:00.000Z",
  updated_at: "2026-06-19T00:00:00.000Z",
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    task_id: "task-1",
    project_id: "project-1",
    spec_id: "manual-spec",
    title: "Task",
    description: "",
    status: "backlog",
    order_index: 1,
    dependency_ids: [],
    parent_task_id: null,
    assigned_agent_instance_id: null,
    completed_by_agent_instance_id: null,
    session_id: null,
    execution_notes: "",
    files_changed: [],
    live_output: "",
    total_input_tokens: 0,
    total_output_tokens: 0,
    created_at: "2026-06-19T00:00:00.000Z",
    updated_at: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

function registerProjectActions(overrides: Partial<ProjectActions> = {}) {
  useProjectActionStore.setState({
    actions: {
      project,
      setProject: vi.fn(),
      message: "",
      handleArchive: vi.fn(),
      navigateToExecution: vi.fn(),
      initialSpecs: [],
      initialTasks: [],
      ...overrides,
    },
  });
}

describe("AddTaskForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerProjectActions();
    useProjectsListStore.setState({
      agentsByProject: {
        "project-1": [builderAgent],
      },
    });
    vi.mocked(tasksApi.createTask).mockResolvedValue(makeTask());
  });

  it("allows creating a manual task when the project has no specs", async () => {
    const onDone = vi.fn();
    render(
      <AddTaskForm
        isOpen
        projectId="project-1"
        status="backlog"
        onDone={onDone}
        onStatusChange={vi.fn()}
      />,
    );

    const createButton = screen.getByRole("button", { name: "Create Task" });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Add metrics component coverage" },
    });

    expect(createButton).toBeEnabled();
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(tasksApi.createTask).toHaveBeenCalledTimes(1);
    });
    const [, body] = vi.mocked(tasksApi.createTask).mock.calls[0];
    expect(body).toMatchObject({
      title: "Add metrics component coverage",
      status: "backlog",
    });
    expect(body).not.toHaveProperty("spec_id");
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
  });

  it("keeps sending the selected spec id when specs exist", async () => {
    registerProjectActions({
      initialSpecs: [
        {
          spec_id: "spec-1",
          project_id: "project-1",
          title: "Plan",
          order_index: 0,
          markdown_contents: "",
          created_at: "2026-06-19T00:00:00.000Z",
          updated_at: "2026-06-19T00:00:00.000Z",
        },
      ],
    });
    render(
      <AddTaskForm
        isOpen
        projectId="project-1"
        status="to_do"
        onDone={vi.fn()}
        onStatusChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Task title"), {
      target: { value: "Implement plan task" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => {
      expect(tasksApi.createTask).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ spec_id: "spec-1" }),
      );
    });
  });
});
