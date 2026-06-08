import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import { useUIModalStore } from "../../../../stores/ui-modal-store";
import {
  GalleryProvider,
  SessionGalleryContext,
  type GalleryItem,
} from "../../../../components/Gallery";

const mockOpenGallery = vi.fn();

vi.mock("../../../../components/Gallery/use-gallery", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useGallery: () => ({
      openGallery: mockOpenGallery,
      closeGallery: vi.fn(),
    }),
  };
});

// Stub the icon library wholesale so MessageBubble (and its
// transitive imports — `agent-store` -> `permissions.ts` pulls in
// `Plus`, etc.) compiles in jsdom without us having to enumerate
// every icon. Vitest requires the factory to return a real object
// (not a Proxy), so we extend importOriginal: any named import
// that exists upstream is replaced with a no-op component.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const NoopIcon = () => null;
  const stubbed: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) {
    stubbed[key] = NoopIcon;
  }
  return stubbed;
});

vi.mock("../../../../shared/hooks/use-highlighted-html", () => ({
  useHighlightedHtml: () => "",
}));

vi.mock("../../../../components/ResponseBlock", () => ({
  ResponseBlock: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../LLMOutput", () => ({
  LLMOutput: ({ content }: { content: string }) => <div data-testid="llm-output">{content}</div>,
}));

vi.mock("./LargeTextBlock", () => ({
  LargeTextBlock: ({ text }: { text: string }) => <div>{text}</div>,
  isLargeText: () => false,
}));

vi.mock("../../../../components/CopyButton", () => ({
  CopyButton: ({ ariaLabel }: { ariaLabel: string }) => (
    <button type="button" aria-label={ariaLabel}>copy</button>
  ),
}));

vi.mock("../../../../components/ReportBugButton", () => ({
  ReportBugButton: () => (
    <button type="button" aria-label="Report bug">Report bug</button>
  ),
}));

vi.mock("./MessageBubble.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

// Pre-seeded agent so the cross-agent badge tests below can assert on
// the resolved display name rather than a UUID-prefix fallback. The
// existing `agent-store` Zustand singleton is shared across the test
// suite, so we hydrate it synchronously up front and reset to an
// empty list in `afterEach` to keep tests independent.
import { useAgentStore } from "../../../agents/stores/agent-store";

const KNOWN_SENDER_ID = "11111111-1111-1111-1111-111111111111";
const KNOWN_SENDER_NAME = "Barret";
function seedAgentStoreWithKnownSender() {
  useAgentStore.setState({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- partial Agent shape is sufficient; the bubble only reads `agent_id` + `name`.
    agents: [{ agent_id: KNOWN_SENDER_ID, name: KNOWN_SENDER_NAME } as any],
  });
}
function clearAgentStore() {
  useAgentStore.setState({ agents: [] });
}

describe("MessageBubble", () => {
  afterEach(() => {
    useUIModalStore.setState({ buyCreditsOpen: false });
    clearAgentStore();
    mockOpenGallery.mockReset();
  });

  it("renders the error message inline with the Buy credits button for insufficient credits errors", () => {
    render(
      <MessageBubble
        message={{
          id: "error-1",
          role: "assistant",
          content: "",
          errorMessage: "You have no credits remaining. Buy more credits to continue.",
          displayVariant: "insufficientCreditsError",
        }}
      />,
    );

    // The error string is rendered verbatim on its own line
    // inside the error chrome (no truncation / no `title`
    // tooltip).
    expect(
      screen.getByText(
        "You have no credits remaining. Buy more credits to continue.",
      ),
    ).toBeInTheDocument();
    // Inline one-click copy for the error message is wired up.
    expect(
      screen.getByRole("button", { name: "Copy error message" }),
    ).toBeInTheDocument();

    // Buy credits sits on the meta row below the error message.
    fireEvent.click(screen.getByRole("button", { name: "Buy credits" }));
    expect(useUIModalStore.getState().buyCreditsOpen).toBe(true);

    // No top-of-bubble LLMOutput is rendered when there is no
    // streaming prefix to show -- avoids the duplicate-text shape
    // the chat used to fall back to.
    expect(screen.queryByTestId("llm-output")).not.toBeInTheDocument();
  });

  it("renders the full error message on its own line above the Support ID + Report Bug meta row for unbucketed errors", () => {
    render(
      <MessageBubble
        message={{
          id: "error-2",
          role: "assistant",
          content: "",
          errorMessage: "Model call timed out after 180s",
          supportId: "abc123def456",
        }}
      />,
    );

    // Error message is the visible text on the first line (no
    // truncation / `title` tooltip).
    expect(
      screen.getByText("Model call timed out after 180s"),
    ).toBeInTheDocument();
    // One-click copy for the error message itself.
    expect(
      screen.getByRole("button", { name: "Copy error message" }),
    ).toBeInTheDocument();
    // Support ID label + value are rendered on the meta row.
    expect(screen.getByText("Support ID")).toBeInTheDocument();
    expect(screen.getByText("abc123def456")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy support id" }),
    ).toBeInTheDocument();
    // Report bug button is wired up.
    expect(screen.getByRole("button", { name: "Report bug" })).toBeInTheDocument();
    // Buy credits should NOT appear for this variant.
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
  });

  it("renders the agent + device context on error bubbles when errorAgentInfo is provided", () => {
    render(
      <MessageBubble
        message={{
          id: "error-agent-info-1",
          role: "assistant",
          content: "",
          errorMessage: "local harness startup failed",
        }}
        errorAgentInfo={{
          name: "Aura",
          machineType: "local",
          status: "idle",
          clientDevice: "Desktop - Windows (DESKTOP-ABC)",
          agentMachine: "DESKTOP-ABC",
        }}
      />,
    );

    // Agent identity line: name + local/remote + status.
    expect(screen.getByText(/Aura \(local, idle\)/)).toBeInTheDocument();
    // Both device descriptors render so a shared error reports where it
    // happened and which machine the agent runs on.
    expect(
      screen.getByText("Desktop - Windows (DESKTOP-ABC)"),
    ).toBeInTheDocument();
    expect(screen.getByText("DESKTOP-ABC")).toBeInTheDocument();
  });

  it("omits the agent + device context when errorAgentInfo is absent (read-only surfaces)", () => {
    render(
      <MessageBubble
        message={{
          id: "error-agent-info-2",
          role: "assistant",
          content: "",
          errorMessage: "connection lost",
        }}
      />,
    );

    expect(screen.getByText("connection lost")).toBeInTheDocument();
    expect(screen.queryByText("Agent")).not.toBeInTheDocument();
  });

  it("renders a Retry button on error bubbles and fires onRetry when clicked", () => {
    const onRetry = vi.fn();
    render(
      <MessageBubble
        message={{
          id: "error-retry-1",
          role: "assistant",
          content: "",
          errorMessage: "Server is busy — try again in 5 seconds.",
          displayVariant: "harnessCapacityExhaustedError",
        }}
        onRetry={onRetry}
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render Retry for the insufficient-credits variant even when onRetry is provided", () => {
    render(
      <MessageBubble
        message={{
          id: "error-retry-2",
          role: "assistant",
          content: "",
          errorMessage: "You have no credits remaining. Buy more credits to continue.",
          displayVariant: "insufficientCreditsError",
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // The variant-specific action stays in place.
    expect(screen.getByRole("button", { name: "Buy credits" })).toBeInTheDocument();
  });

  it("does not render Retry when no onRetry callback is supplied (read-only surfaces)", () => {
    render(
      <MessageBubble
        message={{
          id: "error-retry-3",
          role: "assistant",
          content: "",
          errorMessage: "Model call timed out after 180s",
          supportId: "abc123def456",
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("preserves the partial streaming prefix in LLMOutput while routing the error to the action row", () => {
    render(
      <MessageBubble
        message={{
          id: "error-3",
          role: "assistant",
          content: "Here is the start of my answer",
          errorMessage: "connection lost",
          supportId: "deadbeefcafe",
        }}
      />,
    );

    // The pre-error prefix renders verbatim through LLMOutput,
    // unchanged by error chrome.
    expect(screen.getByTestId("llm-output")).toHaveTextContent(
      "Here is the start of my answer",
    );
    // The error string lives in the error chrome, not inside
    // the prefix.
    expect(screen.getByText("connection lost")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-output")).not.toHaveTextContent(
      "connection lost",
    );
  });

  it("does not render the error action row on successful turns", () => {
    render(
      <MessageBubble
        message={{
          id: "ok-1",
          role: "assistant",
          content: "All done.",
        }}
      />,
    );

    // The chat shows the assistant content normally.
    expect(screen.getByTestId("llm-output")).toHaveTextContent("All done.");
    // No support id chip, no report bug, no buy credits, no
    // truncated error span -- the action row is gated entirely
    // on error chrome being present.
    expect(screen.queryByText("Support ID")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
  });

  it("renders normal assistant content unchanged when no error chrome is present", () => {
    render(
      <MessageBubble
        message={{
          id: "message-1",
          role: "assistant",
          content: "*Error: something broke*",
        }}
      />,
    );

    // The pre-existing fallback shape (model-emitted markdown that
    // happens to look like an error) is still rendered through
    // LLMOutput verbatim because no `errorMessage`/`displayVariant`
    // is set on the event itself.
    expect(screen.getByTestId("llm-output")).toHaveTextContent("*Error: something broke*");
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report bug" })).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // Cross-agent provenance badge ("Fix A" — wire-level + UI rebadge)
  //
  // When the persisted user_message carries `from_agent_id` (set by
  // the server-side `parse_user_message_event` for any row injected
  // by another agent — A→B inbound or B→A async reply), the bubble
  // must render a small "↩ from <agent>" badge above it. Without
  // this label, async replies posted back into the originating
  // agent's chat by `spawn_cross_agent_reply_callback` show up as
  // duplicates of the user's own input — exactly the regression
  // these pin tests guard against.
  // ----------------------------------------------------------------

  it("renders a 'from <agent>' badge on user messages with fromAgentId set, resolving the name from agent-store", () => {
    seedAgentStoreWithKnownSender();
    render(
      <MessageBubble
        message={{
          id: "cross-1",
          role: "user",
          content: "Hello back!",
          fromAgentId: KNOWN_SENDER_ID,
        }}
      />,
    );

    // Resolved display name lands in the badge body.
    expect(screen.getByText(`from ${KNOWN_SENDER_NAME}`)).toBeInTheDocument();
    // Full UUID stays accessible via the tooltip so power users
    // can still grab the canonical handle.
    expect(
      screen.getByTitle(`Cross-agent reply from agent ${KNOWN_SENDER_ID}`),
    ).toBeInTheDocument();
  });

  it("falls back to a truncated id when the sender is not in the local agent-store", () => {
    // Cross-org scenario: the originating agent's UI has never
    // fetched the sending org's agents, so `useAgentStore` has no
    // matching record. The badge must still render — we degrade to
    // an 8-char id prefix instead of disappearing.
    const unknownId = "abcdef01-2345-6789-abcd-ef0123456789";
    render(
      <MessageBubble
        message={{
          id: "cross-2",
          role: "user",
          content: "Hi",
          fromAgentId: unknownId,
        }}
      />,
    );
    expect(screen.getByText("from abcdef01…")).toBeInTheDocument();
  });

  it("does not render the badge on regular human-typed user messages", () => {
    // Negative pin: the badge UI is gated entirely on
    // `fromAgentId` being set. A regular prompt must NOT acquire
    // the badge — that mislabel would be just as confusing as the
    // pre-fix behavior.
    render(
      <MessageBubble
        message={{
          id: "human-1",
          role: "user",
          content: "Hi there",
        }}
      />,
    );
    expect(screen.queryByText(/^from /)).not.toBeInTheDocument();
  });

  it("does not render the badge on assistant messages even when fromAgentId is somehow present", () => {
    // Defensive pin: the field semantics restrict it to user
    // rows, but we double-gate on `role === "user"` in the
    // renderer so a stray server-side bug or future producer
    // can't accidentally tag assistant turns with the badge.
    render(
      <MessageBubble
        message={{
          id: "asst-1",
          role: "assistant",
          content: "Done",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional bad-shape input to assert the role gate
          fromAgentId: KNOWN_SENDER_ID as any,
        }}
      />,
    );
    expect(screen.queryByText(/^from /)).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------------
  // Session-wide gallery navigation. Clicking any user-attached
  // image must open the shared lightbox with EVERY image the
  // transcript has published via `SessionGalleryContext`, not just
  // the current message's images. The provider is mounted at the
  // chat-list level so the click handler here only needs to read
  // the context and forward the aggregated list to `openGallery`.
  // ----------------------------------------------------------------

  it("opens the gallery with the session-wide list when the context is populated", () => {
    const sessionItems: GalleryItem[] = [
      { id: "older-img", src: "https://cdn/older.png", alt: "older" },
      { id: "msg-1-img-0", src: "https://cdn/now.png", alt: "now" },
      { id: "newer-img", src: "https://cdn/newer.png", alt: "newer" },
    ];
    render(
      <GalleryProvider>
        <SessionGalleryContext.Provider value={sessionItems}>
          <MessageBubble
            message={{
              id: "msg-1",
              role: "user",
              content: "",
              contentBlocks: [
                {
                  type: "image",
                  media_type: "image/png",
                  data: "AAAA",
                  source_url: "https://cdn/now.png",
                },
              ],
            }}
          />
        </SessionGalleryContext.Provider>
      </GalleryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open image in gallery/i }));
    expect(mockOpenGallery).toHaveBeenCalledTimes(1);
    expect(mockOpenGallery).toHaveBeenCalledWith({
      items: sessionItems,
      initialId: "msg-1-img-0",
    });
  });

  it("falls back to the per-message list when no session context is mounted", () => {
    // Outside the chat transcript (isolated tests, standalone
    // bubble previews) there is no `SessionGalleryContext`
    // provider — the bubble must still open the lightbox with
    // its own attached images so legacy callers keep working.
    render(
      <MessageBubble
        message={{
          id: "msg-2",
          role: "user",
          content: "",
          contentBlocks: [
            {
              type: "image",
              media_type: "image/png",
              data: "AAAA",
              source_url: "https://cdn/a.png",
            },
            {
              type: "image",
              media_type: "image/png",
              data: "BBBB",
              source_url: "https://cdn/b.png",
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /open image in gallery/i })[1]);
    expect(mockOpenGallery).toHaveBeenCalledTimes(1);
    const callArg = mockOpenGallery.mock.calls[0][0];
    expect(callArg.initialId).toBe("msg-2-img-1");
    expect(callArg.items).toHaveLength(2);
    expect(callArg.items.map((i: GalleryItem) => i.src)).toEqual([
      "https://cdn/a.png",
      "https://cdn/b.png",
    ]);
  });
});
