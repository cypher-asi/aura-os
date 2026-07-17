import { describe, expect, it, vi } from "vitest";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Agent } from "../../../shared/types";

const { mockCreateSkill } = vi.hoisted(() => ({
  mockCreateSkill: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    children,
    footer,
  }: {
    isOpen: boolean;
    children?: ReactNode;
    footer?: ReactNode;
  }) =>
    isOpen ? (
      <div>
        {children}
        {footer}
      </div>
    ) : null,
  Input: ({
    validationMessage,
    ...props
  }: InputHTMLAttributes<HTMLInputElement> & { validationMessage?: string }) => {
    void validationMessage;
    return <input {...props} />;
  },
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      createSkill: mockCreateSkill,
    },
  },
}));

vi.mock("./SkillAgentTargetField", () => ({
  SkillAgentTargetField: ({
    value,
    onChange,
    agents,
  }: {
    value: string;
    onChange: (value: string) => void;
    agents: Agent[];
  }) => (
    <select
      aria-label="Collaborating agent"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">No direct collaborator</option>
      {agents.map((agent) => (
        <option key={agent.agent_id} value={agent.agent_id}>
          {agent.name}
        </option>
      ))}
    </select>
  ),
}));

import { CreateSkillModal } from "./CreateSkillModal";

describe("CreateSkillModal", () => {
  it("creates and installs a skill with its selected collaborator", async () => {
    mockCreateSkill.mockResolvedValueOnce({
      name: "request-review",
      created: true,
      registered: true,
      installed_on_agent: true,
    });
    const onCreated = vi.fn();
    const onClose = vi.fn();

    render(
      <CreateSkillModal
        isOpen
        onClose={onClose}
        onCreated={onCreated}
        agentId="00000000-0000-0000-0000-000000000001"
        availableAgents={[
          {
            agent_id: "00000000-0000-0000-0000-000000000002",
            name: "Security Reviewer",
            role: "Reviewer",
          } as Agent,
        ]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("e.g. deploy"), {
      target: { value: "request-review" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("e.g. Deploy the application to production"),
      { target: { value: "Request a security review" } },
    );
    fireEvent.change(screen.getByPlaceholderText("Markdown instructions for this skill..."), {
      target: { value: "Delegate the review and wait for the reply." },
    });
    fireEvent.change(screen.getByLabelText("Collaborating agent"), {
      target: { value: "00000000-0000-0000-0000-000000000002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Skill" }));

    await waitFor(() => {
      expect(mockCreateSkill).toHaveBeenCalledWith({
        name: "request-review",
        description: "Request a security review",
        body: "Delegate the review and wait for the reply.",
        agent_target: {
          agent_id: "00000000-0000-0000-0000-000000000002",
          name: "Security Reviewer",
        },
        agent_id: "00000000-0000-0000-0000-000000000001",
      });
    });
    expect(onCreated).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
