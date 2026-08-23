import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QuickPromptModal } from "./QuickPromptModal";
import { useQuickPromptStore } from "../../stores/quick-prompt-store";

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
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
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

const fetchAgents = vi.fn().mockResolvedValue(undefined);
const agentState = {
  agents: [
    { agent_id: "agent-1", name: "Atlas", machine_type: "remote" },
    { agent_id: "agent-2", name: "Hermes", machine_type: "remote" },
  ],
  agentsStatus: "ready",
  fetchAgents,
};

vi.mock("../../apps/agents/stores/agent-store", () => ({
  useAgentStore: Object.assign(
    (selector: (state: typeof agentState) => unknown) => selector(agentState),
    { getState: () => agentState },
  ),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ remoteOnly: false }),
}));

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}</output>;
}

describe("QuickPromptModal", () => {
  beforeEach(() => {
    useQuickPromptStore.setState({
      isOpen: false,
      preferredAgentId: null,
      pendingPrompt: null,
    });
  });

  it("preselects the current agent and hands the reviewed draft to chat", async () => {
    useQuickPromptStore.getState().open("agent-2");
    render(
      <MemoryRouter initialEntries={["/notes"]}>
        <QuickPromptModal />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Agent")).toHaveValue("agent-2"));
    fireEvent.change(screen.getByLabelText("What do you want to work on?"), {
      target: { value: "Compare the release options" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Open in chat" }));

    await waitFor(() =>
      expect(screen.getByLabelText("location")).toHaveTextContent("/agents/agent-2"),
    );
    expect(useQuickPromptStore.getState().pendingPrompt).toMatchObject({
      agentId: "agent-2",
      text: "Compare the release options",
    });
  });
});
