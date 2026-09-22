import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  commands: [] as Array<Record<string, unknown>>,
  retry: vi.fn().mockResolvedValue(true),
  cancel: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../stores/chat-command-outbox", () => ({
  useChatCommandOutboxStore: (
    selector: (state: { commands: Array<Record<string, unknown>> }) => unknown,
  ) => selector({ commands: mocks.commands }),
  retryChatCommandNow: mocks.retry,
  cancelChatCommandReplay: mocks.cancel,
}));

vi.mock("lucide-react", () => ({
  ExternalLink: () => null,
  RefreshCw: () => null,
  X: () => null,
}));

import { PendingAgentSends } from "./PendingAgentSends";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

describe("PendingAgentSends", () => {
  beforeEach(() => {
    mocks.commands = [];
    mocks.retry.mockClear();
    mocks.cancel.mockClear();
  });

  it("stays hidden when this environment has no unconfirmed sends", () => {
    render(<MemoryRouter><PendingAgentSends /></MemoryRouter>);
    expect(screen.queryByRole("region", { name: "Unconfirmed agent sends" })).not.toBeInTheDocument();
  });

  it("opens, retries, and removes a persisted project-agent send", async () => {
    mocks.commands = [{
      surface: "project",
      commandId: "command-1",
      ownerId: "user-1",
      hostOrigin: "https://environment.example",
      projectId: "project-1",
      agentInstanceId: "instance-1",
      sessionId: "session-1",
      content: "Continue the migration after reconnecting",
      action: null,
      originallyStartedNewSession: false,
      createdAt: Date.now(),
      attempts: 1,
      nextAttemptAt: Date.now(),
    }];
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PendingAgentSends />
        <LocationProbe />
      </MemoryRouter>,
    );

    expect(screen.getByText("1 message waiting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Open conversation for: Continue the migration after reconnecting",
    }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/agents/instance-1?session=session-1",
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Retry now: Continue the migration after reconnecting",
    }));
    await waitFor(() => expect(mocks.retry).toHaveBeenCalledWith("command-1"));

    fireEvent.click(screen.getByRole("button", {
      name: "Stop retrying: Continue the migration after reconnecting",
    }));
    await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("command-1"));
  });

  it("routes standalone sends through the persistent agent identity", () => {
    mocks.commands = [{
      surface: "agent",
      commandId: "command-2",
      ownerId: "user-1",
      hostOrigin: "https://environment.example",
      agentId: "agent-1",
      projectId: "project-1",
      sessionId: "session-2",
      content: "Check the deploy",
      action: null,
      originallyStartedNewSession: false,
      createdAt: Date.now(),
      attempts: 1,
      nextAttemptAt: Date.now(),
    }];
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PendingAgentSends />
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Open conversation for: Check the deploy",
    }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/agents/agent-1?project=project-1&session=session-2",
    );
  });
});
