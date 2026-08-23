import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { MessageActions } from "./MessageActions";
import { registerRegenerateTurn } from "./regenerate-registry";

const createSessionShare = vi.fn();
const branchSession = vi.fn();

vi.mock("../../../../shared/api/shares", () => ({
  createSessionShare: (...args: unknown[]) => createSessionShare(...args),
}));

vi.mock("../../../../shared/api/agents", () => ({
  sessionsApi: {
    branchSession: (...args: unknown[]) => branchSession(...args),
  },
}));

vi.mock("../../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: unknown) => unknown) =>
    selector({
      projects: [{ project_id: "p1", name: "Demo Project" }],
      agentsByProject: {
        p1: [{ agent_instance_id: "ai1", workspace_path: "/ws/demo" }],
      },
    }),
}));

const STREAM_KEY = "p1:ai1:s1";
const message: DisplaySessionEvent = {
  id: "a1",
  role: "assistant",
  content: "assistant answer",
};

describe("MessageActions", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    createSessionShare.mockReset();
    branchSession.mockReset();
    writeText.mockReset();
    window.history.replaceState(null, "", "/");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  it("creates a share, copies the url, and flips the share button to copied", async () => {
    createSessionShare.mockResolvedValue({
      shareId: "t_abc",
      url: "https://aura.ai/s/t_abc",
    });
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);

    fireEvent.click(screen.getByLabelText("Copy share link"));

    await waitFor(() =>
      expect(createSessionShare).toHaveBeenCalledWith({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s1",
      }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("https://aura.ai/s/t_abc"),
    );
    expect(await screen.findByLabelText("Share link copied")).toBeInTheDocument();
  });

  it("uses the current url session when the stream key is still fresh", async () => {
    window.history.replaceState(null, "", "/projects/p1/agents/ai1?session=s-from-url");
    createSessionShare.mockResolvedValue({
      shareId: "t_abc",
      url: "https://aura.ai/s/t_abc",
    });
    render(<MessageActions message={message} streamKey="p1:ai1:fresh" />);

    fireEvent.click(screen.getByLabelText("Copy share link"));

    await waitFor(() =>
      expect(createSessionShare).toHaveBeenCalledWith({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s-from-url",
      }),
    );
  });

  it("uses canonical chat route params when the stream key is agent-scoped", async () => {
    window.history.replaceState(
      null,
      "",
      "/chat?project=p1&instance=ai1&session=s-from-chat&agent=agent-1",
    );
    createSessionShare.mockResolvedValue({
      shareId: "t_abc",
      url: "https://aura.ai/s/t_abc",
    });
    render(<MessageActions message={message} streamKey="agent-1:s-from-chat" />);

    fireEvent.click(screen.getByLabelText("Copy share link"));

    await waitFor(() =>
      expect(createSessionShare).toHaveBeenCalledWith({
        projectId: "p1",
        agentInstanceId: "ai1",
        sessionId: "s-from-chat",
      }),
    );
  });

  it("keeps the share button visible but disabled before a session exists", () => {
    render(<MessageActions message={message} streamKey="p1:ai1:fresh" />);

    const share = screen.getByLabelText("Share link unavailable until session is ready");
    expect(share).toBeDisabled();
  });

  it("invokes the registered regenerate handler with the message id", () => {
    const regenerate = vi.fn();
    registerRegenerateTurn(STREAM_KEY, regenerate);
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);

    fireEvent.click(screen.getByLabelText("Regenerate response"));
    expect(regenerate).toHaveBeenCalledWith("a1");
  });

  it("branches through the selected reply and opens the new session", async () => {
    window.history.replaceState(null, "", "/projects/p1/agents/ai1?session=s1");
    branchSession.mockResolvedValue({ sessionId: "s-branch", copiedEvents: 4 });
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);

    fireEvent.click(screen.getByLabelText("Branch conversation here"));

    await waitFor(() =>
      expect(branchSession).toHaveBeenCalledWith("p1", "ai1", "s1", "a1"),
    );
    await waitFor(() =>
      expect(window.location.search).toContain("session=s-branch"),
    );
  });

  it("disables branching before a persisted session exists", () => {
    render(<MessageActions message={message} streamKey="p1:ai1:fresh" />);
    expect(screen.getByLabelText("Branch conversation here")).toBeDisabled();
  });

  it("opens the details popover and shows the metadata", () => {
    render(<MessageActions message={message} streamKey={STREAM_KEY} />);
    fireEvent.click(screen.getByLabelText("More details"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Demo Project")).toBeInTheDocument();
    expect(screen.getByText("/ws/demo")).toBeInTheDocument();
  });
});
