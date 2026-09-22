import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const { respondToUserInput } = vi.hoisted(() => ({
  respondToUserInput: vi.fn(),
}));

vi.mock("../../../shared/api/streams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../shared/api/streams")>();
  return { ...actual, streamsApi: { ...actual.streamsApi, respondToUserInput } };
});

import { useAgentAttentionStore } from "../../../stores/agent-attention-store";
import { UserInputPromptCard } from "./UserInputPromptCard";

function seed() {
  useAgentAttentionStore.setState({
    pendingInputs: {
      "input-1": {
        kind: "input",
        requestId: "input-1",
        agentId: "agent-1",
        projectId: "project-1",
        agentInstanceId: "instance-1",
        sessionId: "session-1",
        route: "/projects/project-1/agents/instance-1?session=session-1",
        startedAt: 10,
        questions: [
          {
            id: "approach",
            header: "Approach",
            question: "Which implementation should I use?",
            options: [
              { label: "Safe", description: "Keep the change narrow" },
              { label: "Fast", description: "Optimize for delivery" },
            ],
            multi_select: false,
          },
          {
            id: "checks",
            header: "Checks",
            question: "Which checks should I run?",
            options: [
              { label: "Unit", description: "Run unit tests" },
              { label: "E2E", description: "Run browser tests" },
            ],
            multi_select: true,
          },
        ],
      },
    },
  });
}

afterEach(() => {
  cleanup();
  respondToUserInput.mockReset();
  useAgentAttentionStore.getState().clear();
});

describe("UserInputPromptCard", () => {
  it("answers every typed question and resumes the environment-owned agent", async () => {
    respondToUserInput.mockResolvedValue({ accepted: true });
    seed();
    render(
      <MemoryRouter initialEntries={[
        "/projects/project-1/agents/instance-1?session=session-1&view=chat",
      ]}>
        <UserInputPromptCard />
      </MemoryRouter>,
    );

    const continueButton = screen.getByRole("button", { name: "Continue agent" });
    expect(continueButton).toBeDisabled();
    await userEvent.setup().click(screen.getByRole("radio", { name: /Safe/ }));
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /Unit/ }));
    await userEvent.setup().click(continueButton);

    await waitFor(() => expect(respondToUserInput).toHaveBeenCalledWith("input-1", {
      approach: "Safe",
      checks: ["Unit"],
    }));
    expect(screen.queryByRole("region", { name: "Agent question" })).not.toBeInTheDocument();
  });

  it("keeps the prompt and shows an error when delivery fails", async () => {
    respondToUserInput.mockRejectedValue(new Error("Connection lost"));
    seed();
    render(
      <MemoryRouter initialEntries={[
        "/projects/project-1/agents/instance-1?session=session-1",
      ]}>
        <UserInputPromptCard />
      </MemoryRouter>,
    );

    await userEvent.setup().click(screen.getByRole("radio", { name: /Fast/ }));
    await userEvent.setup().click(screen.getByRole("checkbox", { name: /E2E/ }));
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue agent" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(screen.getByRole("region", { name: "Agent question" })).toBeInTheDocument();
  });
});
