import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/agents/AgentInfoPanel/ChatsTab", () => ({
  ChatsTab: ({ showActionButtons }: { showActionButtons?: boolean }) => (
    <div data-touch-actions={String(Boolean(showActionButtons))}>Shared recent sessions</div>
  ),
}));

vi.mock("../../../stores/sessions-list-store", () => ({
  agentSessionsSurfaceKey: (agentId: string) => `agent:${agentId}`,
  useMostRecentSession: () => ({
    session_id: "session-1",
    _projectId: "recent-project",
    _agentInstanceId: "instance-1",
  }),
}));

import { MobileAgentResumeSection } from "./MobileAgentResumeSection";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderSection(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route
          path="*"
          element={(
            <>
              <MobileAgentResumeSection agentId="agent-1" />
              <LocationProbe />
            </>
          )}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MobileAgentResumeSection", () => {
  it("returns to the same canonical session when continuing chat", async () => {
    const user = userEvent.setup();
    renderSection(
      "/agents/agent-1?project=project-1&instance=instance-1&session=session-1&view=details",
    );

    await user.click(screen.getByRole("button", { name: "Continue chat" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/agents/agent-1?project=project-1&instance=instance-1&session=session-1",
    );
  });

  it("opens the exact session workspace and exposes recent shared chats", async () => {
    const user = userEvent.setup();
    renderSection("/agents/agent-1?view=details");

    expect(screen.getByText("Shared recent sessions")).toBeInTheDocument();
    expect(screen.getByText("Shared recent sessions")).toHaveAttribute("data-touch-actions", "true");
    await user.click(screen.getByRole("button", { name: "Browse code" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/recent-project/files?instance=instance-1&agent=agent-1&session=session-1",
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/recent-project/files?instance=instance-1&agent=agent-1&session=session-1&view=changes",
    );
  });

  it("keeps route-selected workspace identity ahead of another recent session", async () => {
    const user = userEvent.setup();
    renderSection(
      "/agents/agent-1?project=project-1&instance=route-instance&view=details",
    );

    await user.click(screen.getByRole("button", { name: "Review changes" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/files?instance=route-instance&agent=agent-1&view=changes",
    );
  });

  it("preserves the selected session when opening its workspace", async () => {
    const user = userEvent.setup();
    renderSection(
      "/agents/agent-1?project=project-1&instance=route-instance&session=route-session&view=details",
    );

    await user.click(screen.getByRole("button", { name: "Browse code" }));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/files?instance=route-instance&agent=agent-1&session=route-session",
    );
  });
});
