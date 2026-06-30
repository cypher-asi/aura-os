import { render, screen } from "@testing-library/react";
import { vi } from "vitest";

// ── Render-count probes for every memoized slot component ─────────
// The property under test: a keystroke (new `input` prop) must
// reconcile only the textarea path — every chrome region's props stay
// referentially stable so its memo bails out. The probes mirror the
// real components' memoization; a bumped counter means the orchestrator
// handed that slot an unstable prop.
const probes = {
  modelControls: 0,
  modeBar: 0,
  projectPicker: 0,
  agentInfoBar: 0,
  attachControl: 0,
  statusHints: 0,
  attachmentPreviews: 0,
};

function makeProbe(key: keyof typeof probes) {
  return async () => {
    const React = await import("react");
    const Probe = React.memo(function Probe() {
      // Test-only render counter: deliberately mutated during render to
      // count how often the memoized component is invoked.
      probes[key] += 1;
      return null;
    });
    return Probe;
  };
}

vi.mock("./ModelControls", async () => ({ ModelControls: await makeProbe("modelControls")() }));
vi.mock("./ChatModeBar", async () => ({ ChatModeBar: await makeProbe("modeBar")() }));
vi.mock("./ProjectPicker", async () => ({ ProjectPicker: await makeProbe("projectPicker")() }));
vi.mock("./AgentInfoBar", async () => ({ AgentInfoBar: await makeProbe("agentInfoBar")() }));
vi.mock("./AttachControl", async () => ({ AttachControl: await makeProbe("attachControl")() }));
vi.mock("./InputStatusHints", async () => ({ InputStatusHints: await makeProbe("statusHints")() }));
vi.mock("./AttachmentPreviews", async () => ({ AttachmentPreviews: await makeProbe("attachmentPreviews")() }));

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
}));

vi.mock("../../../stores/chat-ui-store", () => {
  const stable = {
    selectedMode: "code",
    selectedModel: "aura-claude-opus-4-6",
    selectedEffort: null,
    imageQuality: "medium",
    projectId: null,
    pinnedSourceImage: null,
    councilCount: 1,
    councilModels: [],
    councilMechanism: "synthesize",
    answerStrategy: "single",
    secondOpinionReference: null,
    setSelectedMode: vi.fn(),
    setSelectedModel: vi.fn(),
    setCouncilCount: vi.fn(),
    setCouncilModel: vi.fn(),
    setCouncilMechanism: vi.fn(),
    setAnswerStrategy: vi.fn(),
    setSecondOpinionReference: vi.fn(),
    setSelectedEffort: vi.fn(),
    setImageQuality: vi.fn(),
    setProjectId: vi.fn(),
    setPinnedSourceImage: vi.fn(),
    init: vi.fn(),
    syncAvailableModels: vi.fn(),
  };
  return { useChatUI: () => stable };
});

vi.mock("./useFileAttachments", () => {
  const stable = {
    canAddMore: true,
    addFiles: vi.fn(),
    addFileFromPath: vi.fn().mockResolvedValue(undefined),
    handleRemove: vi.fn(),
  };
  return { useFileAttachments: () => stable };
});

import { DesktopChatInputBar } from "./ChatInputBar";

describe("ChatInputBar keystroke render isolation", () => {
  it("does not re-render any chrome slot component when only the draft changes", () => {
    const stableProps = {
      onInputChange: vi.fn(),
      onSend: vi.fn(),
      onStop: vi.fn(),
      streamKey: "stream-1",
      onNewChat: vi.fn(),
    };
    const { rerender } = render(
      <DesktopChatInputBar {...stableProps} input="" />,
    );

    const baseline = { ...probes };
    // Every slot mounted exactly once.
    for (const count of Object.values(baseline)) {
      expect(count).toBeGreaterThan(0);
    }

    // Simulate typing: the controlled draft prop changes per keystroke.
    rerender(<DesktopChatInputBar {...stableProps} input="h" />);
    rerender(<DesktopChatInputBar {...stableProps} input="he" />);
    rerender(<DesktopChatInputBar {...stableProps} input="hel" />);

    expect(probes).toEqual(baseline);
    // The textarea itself did update.
    expect(screen.getByRole("textbox")).toHaveValue("hel");
  });
});
