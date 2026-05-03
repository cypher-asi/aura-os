import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { MobileChatPanel } from "./MobileChatPanel";

vi.mock("../../../apps/chat/components/ChatPanel", () => ({
  ChatPanel: ({
    header,
    InputBarComponent,
  }: {
    header?: React.ReactNode;
    InputBarComponent?: unknown;
  }) => (
    <div data-testid="chat-panel-shell" data-mobile-input={InputBarComponent ? "true" : "false"}>
      {header}
    </div>
  ),
}));

vi.mock("../MobileChatHeader/MobileChatHeader.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function renderMobilePanel(overrides: Partial<React.ComponentProps<typeof MobileChatPanel>> = {}) {
  return render(
    <MemoryRouter>
      <MobileChatPanel
        streamKey="stream-1"
        onSend={vi.fn()}
        onStop={vi.fn()}
        agentName="Coca"
        machineType="remote"
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe("MobileChatPanel", () => {
  it("owns the mobile chat header and input slot", () => {
    renderMobilePanel();

    expect(screen.getByTestId("chat-panel-shell")).toHaveAttribute("data-mobile-input", "true");
    expect(screen.getByText("Coca")).toBeInTheDocument();
    expect(screen.getByText("Remote agent chat")).toBeInTheDocument();
  });

  it("makes the summary actionable when details are available", () => {
    const onDetails = vi.fn();
    renderMobilePanel({ onMobileHeaderSummaryClick: onDetails });

    expect(screen.getByRole("button", { name: "Open details for Coca" })).toBeInTheDocument();
    expect(screen.getByText("Open skills and runtime")).toBeInTheDocument();
  });

  it("can present a project-count summary affordance", () => {
    renderMobilePanel({
      mobileHeaderSummaryTo: "/projects/proj-1/agents/agent-inst-1/details",
      mobileHeaderSummaryHint: "2 agents in project",
      mobileHeaderSummaryLabel: "Open details for Coca",
    });

    expect(screen.getByRole("link", { name: "Open details for Coca" })).toBeInTheDocument();
    expect(screen.getByText("2 agents in project")).toBeInTheDocument();
  });
});
