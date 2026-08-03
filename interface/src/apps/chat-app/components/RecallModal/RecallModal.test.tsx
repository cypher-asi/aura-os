import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { vi } from "vitest";
import { RecallModal } from "./RecallModal";

const mocks = vi.hoisted(() => ({
  search: vi.fn(),
  openSource: vi.fn(),
  addToDraft: vi.fn(),
}));

vi.mock("../../../../api/client", () => ({
  api: { searchMySessionHistory: (...args: unknown[]) => mocks.search(...args) },
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <section aria-label={title}>{children}</section> : null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
  Spinner: () => <span>Loading</span>,
}));

const result = {
  eventId: "event-12345678",
  sessionId: "session-12345678",
  projectId: "project-12345678",
  agentInstanceId: "instance-12345678",
  agentId: "agent-12345678",
  occurredAt: "2026-08-04T10:00:00.000Z",
  role: "assistant" as const,
  snippet: "The safe conversational result.",
};

function renderModal() {
  return render(
    <RecallModal
      isOpen
      onClose={vi.fn()}
      onOpenSource={mocks.openSource}
      onAddToDraft={mocks.addToDraft}
      canAddToDraft
      resolveMetadata={() => ({
        sessionTitle: "Authentication refresh decision",
        projectName: "Aura Desktop",
        agentName: "Engineer",
      })}
    />,
  );
}

function searchFor(query = "authentication") {
  fireEvent.change(screen.getByLabelText("Search completed chats"), { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "Search past chats" }));
}

describe("RecallModal", () => {
  beforeEach(() => {
    mocks.search.mockReset();
    mocks.openSource.mockReset();
    mocks.addToDraft.mockReset();
  });

  it("shows loading and then source-linked result metadata", async () => {
    let resolve: ((value: { results: typeof result[]; scannedSessions: number; skippedSessions: number }) => void) | undefined;
    mocks.search.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderModal();
    searchFor();
    expect(screen.getByText("Loading")).toBeInTheDocument();
    resolve?.({ results: [result], scannedSessions: 1, skippedSessions: 0 });

    await waitFor(() => expect(screen.getByText("Authentication refresh decision")).toBeInTheDocument());
    expect(screen.getByText(/Aura Desktop · Engineer · Assistant/)).toBeInTheDocument();
    expect(screen.getByText(result.snippet)).toBeInTheDocument();
    expect(screen.getByText(/event event-1/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is sent automatically/i)).toBeInTheDocument();
  });

  it("opens a selected result's source without sending content", async () => {
    mocks.search.mockResolvedValue({ results: [result], scannedSessions: 1, skippedSessions: 0 });
    renderModal();
    searchFor();
    await screen.findByText(result.snippet);
    fireEvent.click(screen.getByRole("button", { name: "Open source chat" }));
    expect(mocks.openSource).toHaveBeenCalledWith(result);
    expect(mocks.addToDraft).not.toHaveBeenCalled();
  });

  it("requires a separate action to add a result to the active draft", async () => {
    mocks.search.mockResolvedValue({ results: [result], scannedSessions: 1, skippedSessions: 0 });
    renderModal();
    searchFor();
    await screen.findByText(result.snippet);
    fireEvent.click(screen.getByRole("button", { name: "Add to current draft" }));
    expect(mocks.addToDraft).toHaveBeenCalledWith(result);
    expect(mocks.openSource).not.toHaveBeenCalled();
  });

  it("shows an empty state and a request error", async () => {
    mocks.search.mockResolvedValueOnce({ results: [], scannedSessions: 1, skippedSessions: 0 });
    renderModal();
    searchFor();
    expect(await screen.findByText("No matching completed chats found.")).toBeInTheDocument();

    mocks.search.mockRejectedValueOnce(new Error("Search unavailable"));
    searchFor("different query");
    expect(await screen.findByRole("alert")).toHaveTextContent("Search unavailable");
  });

  it("discloses when only part of chat history was searchable", async () => {
    mocks.search.mockResolvedValue({ results: [result], scannedSessions: 3, skippedSessions: 2 });
    renderModal();
    searchFor();
    expect(await screen.findByRole("status")).toHaveTextContent("Some chats couldn't be searched");

    let resolveNext: ((value: { results: typeof result[]; scannedSessions: number; skippedSessions: number }) => void) | undefined;
    mocks.search.mockReturnValueOnce(new Promise((done) => { resolveNext = done; }));
    searchFor("new query");
    expect(screen.getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText(result.snippet)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    resolveNext?.({ results: [], scannedSessions: 3, skippedSessions: 0 });
    expect(await screen.findByText("No matching completed chats found.")).toBeInTheDocument();
  });
});
