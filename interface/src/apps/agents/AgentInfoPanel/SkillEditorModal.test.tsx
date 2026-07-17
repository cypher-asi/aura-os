import { describe, it, expect, vi } from "vitest";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Agent } from "../../../shared/types";
import type { SkillAgentTargetBinding } from "../../../shared/api/harness-skills";

const { mockGetMySkill, mockUpdateMySkill } = vi.hoisted(() => ({
  mockGetMySkill: vi.fn(),
  mockUpdateMySkill: vi.fn(),
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
      <div data-testid="modal">
        {children}
        {footer}
      </div>
    ) : null,
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Textarea: ({
    mono,
    ...props
  }: TextareaHTMLAttributes<HTMLTextAreaElement> & { mono?: boolean }) => {
    void mono;
    return <textarea {...props} />;
  },
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
  Spinner: () => <span>loading</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      getMySkill: mockGetMySkill,
      updateMySkill: mockUpdateMySkill,
    },
  },
}));

vi.mock("./SkillAgentTargetField", () => ({
  SkillAgentTargetField: ({
    value,
    onChange,
    agents,
    selectedSnapshot,
  }: {
    value: string;
    onChange: (value: string) => void;
    agents: Agent[];
    selectedSnapshot?: SkillAgentTargetBinding;
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
      {selectedSnapshot &&
        !agents.some((agent) => agent.agent_id === selectedSnapshot.agent_id) && (
          <option value={selectedSnapshot.agent_id}>{selectedSnapshot.name}</option>
        )}
    </select>
  ),
}));

import { SkillEditorModal } from "./SkillEditorModal";

describe("SkillEditorModal", () => {
  it("clears the form on open so a failed load never shows the previously-edited skill", async () => {
    // First skill loads fine.
    mockGetMySkill.mockResolvedValueOnce({
      name: "skill-a",
      description: "Desc A",
      body: "Body A",
      user_invocable: true,
      model_invocable: false,
    });
    const { rerender } = render(
      <SkillEditorModal isOpen skillName="skill-a" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(await screen.findByDisplayValue("Desc A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Body A")).toBeInTheDocument();

    // Open a different skill whose load FAILS (e.g. "skill not found").
    mockGetMySkill.mockRejectedValueOnce({ body: { error: "skill not found: skill-b" } });
    rerender(
      <SkillEditorModal isOpen skillName="skill-b" onClose={() => {}} onSaved={() => {}} />,
    );

    // The error surfaces, and crucially the previous skill's content is gone.
    await waitFor(() => {
      expect(screen.getByText("skill not found: skill-b")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("Desc A")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Body A")).not.toBeInTheDocument();
  });

  it("loads and preserves a direct collaborator binding on save", async () => {
    mockGetMySkill.mockResolvedValueOnce({
      name: "request-review",
      description: "Request a security review",
      body: "Delegate the review.",
      user_invocable: true,
      model_invocable: false,
      agent_target: {
        agent_id: "00000000-0000-0000-0000-000000000002",
        name: "Security Reviewer",
      },
    });
    mockUpdateMySkill.mockResolvedValueOnce({
      name: "request-review",
      path: "/skills/request-review/SKILL.md",
      updated: true,
    });
    const onSaved = vi.fn();
    const onClose = vi.fn();

    render(
      <SkillEditorModal
        isOpen
        skillName="request-review"
        onClose={onClose}
        onSaved={onSaved}
        availableAgents={[
          {
            agent_id: "00000000-0000-0000-0000-000000000002",
            name: "Security Reviewer",
          } as Agent,
        ]}
      />,
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Collaborating agent")).toHaveValue(
        "00000000-0000-0000-0000-000000000002",
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockUpdateMySkill).toHaveBeenCalledWith(
        "request-review",
        expect.objectContaining({
          agent_target: {
            agent_id: "00000000-0000-0000-0000-000000000002",
            name: "Security Reviewer",
          },
        }),
      );
    });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
