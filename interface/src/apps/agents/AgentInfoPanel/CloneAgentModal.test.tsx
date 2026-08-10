import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { Agent } from "../../../shared/types";
import { CloneAgentModal } from "./CloneAgentModal";

const mocks = vi.hoisted(() => ({
  clone: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    agents: {
      clone: mocks.clone,
    },
  },
}));

vi.mock("@cypher-asi/zui", async () => {
  const React = await import("react");
  return {
    Modal: ({
      isOpen,
      title,
      children,
      footer,
    }: {
      isOpen: boolean;
      title: string;
      children?: ReactNode;
      footer?: ReactNode;
    }) => isOpen ? <div role="dialog" aria-label={title}>{children}{footer}</div> : null,
    Input: React.forwardRef<
      HTMLInputElement,
      React.InputHTMLAttributes<HTMLInputElement> & { validationMessage?: string }
    >(
      ({ validationMessage, ...props }, ref) => (
        <input ref={ref} aria-invalid={Boolean(validationMessage)} {...props} />
      ),
    ),
    Button: ({
      children,
      onClick,
      disabled,
    }: {
      children?: ReactNode;
      onClick?: () => void;
      disabled?: boolean;
    }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
    Text: ({ children, role }: { children?: ReactNode; role?: string }) => (
      <span role={role}>{children}</span>
    ),
  };
});

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: "remote-1",
    user_id: "user-1",
    name: "Remote Planner",
    role: "planner",
    personality: "methodical",
    system_prompt: "Plan carefully.",
    skills: ["planning"],
    icon: null,
    machine_type: "remote",
    adapter_type: "aura_harness",
    environment: "swarm_microvm",
    auth_source: "aura_managed",
    tags: [],
    is_pinned: false,
    permissions: { scope: { orgs: [], projects: [], agent_ids: [] }, capabilities: [] },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("CloneAgentModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clones to the selected machine type and explains the copy boundary", async () => {
    const source = makeAgent();
    const clone = makeAgent({
      agent_id: "local-2",
      name: "Remote-Planner-copy",
      machine_type: "local",
      environment: "local_host",
    });
    mocks.clone.mockResolvedValue({
      agent: clone,
      copy_report: { copied: ["profile"], not_copied: ["secrets"] },
    });
    const onClose = vi.fn();
    const onCloned = vi.fn();
    const user = userEvent.setup();

    render(
      <CloneAgentModal
        isOpen
        sourceAgent={source}
        localAgentRuntimeAvailable
        onClose={onClose}
        onCloned={onCloned}
      />,
    );

    expect(screen.getByText(/original agent stays unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/chats, memory, workspace files/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Remote-Planner-copy")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /remote/i })).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByRole("radio", { name: /web local/i }));
    await user.click(screen.getByRole("button", { name: "Clone Agent" }));

    await waitFor(() => {
      expect(mocks.clone).toHaveBeenCalledWith(source.agent_id, {
        name: "Remote-Planner-copy",
        machine_type: "local",
      });
    });
    expect(onCloned).toHaveBeenCalledWith(clone);
    expect(onClose).toHaveBeenCalled();
  });

  it("clones a local source to remote when Web Local is unavailable", async () => {
    const source = makeAgent({ machine_type: "local", environment: "local_host" });
    const clone = makeAgent({ agent_id: "remote-2", name: "Remote-Planner-copy" });
    mocks.clone.mockResolvedValue({ agent: clone, copy_report: { copied: [], not_copied: [] } });
    const user = userEvent.setup();

    render(
      <CloneAgentModal
        isOpen
        sourceAgent={source}
        localAgentRuntimeAvailable={false}
        onClose={vi.fn()}
        onCloned={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /web local/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /remote/i })).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Clone Agent" }));

    await waitFor(() => {
      expect(mocks.clone).toHaveBeenCalledWith(source.agent_id, {
        name: "Remote-Planner-copy",
        machine_type: "remote",
      });
    });
  });
});
