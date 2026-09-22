import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { streamsApi } from "../../../shared/api/streams";
import { useToolApprovalStore } from "../../../stores/tool-approval-store";
import { ToolApprovalPromptCard } from "./ToolApprovalPromptCard";

vi.mock("../../../shared/api/streams", () => ({
  streamsApi: { respondToToolApproval: vi.fn() },
}));

const respondToToolApproval = vi.mocked(streamsApi.respondToToolApproval);

describe("ToolApprovalPromptCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolApprovalStore.setState({ prompts: {} });
  });

  it("lets a mobile-sized chat answer a desktop-started approval", async () => {
    respondToToolApproval.mockResolvedValue({ accepted: true });
    useToolApprovalStore.getState().setPrompt("agent:a1:s1", {
      request_id: "approval-1",
      tool_name: "write_file",
      args: { path: "src/main.ts" },
      agent_id: "a1",
      remember_options: ["once", "session"],
    });

    render(<ToolApprovalPromptCard streamKey="agent:a1:s1" />);
    expect(screen.getByText("Approval needed")).toBeDefined();
    expect(screen.getByText("Write File")).toBeDefined();
    fireEvent.change(screen.getByLabelText("Remember"), { target: { value: "session" } });
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));

    await waitFor(() => {
      expect(respondToToolApproval).toHaveBeenCalledWith("approval-1", "on", "session");
      expect(screen.queryByText("Approval needed")).toBeNull();
    });
  });

  it("keeps the prompt actionable when the response transport fails", async () => {
    respondToToolApproval.mockRejectedValue(new Error("Runtime disconnected"));
    useToolApprovalStore.getState().setPrompt("agent:a1:s1", {
      request_id: "approval-2",
      tool_name: "run_command",
      args: { command: "npm test" },
      agent_id: "a1",
      remember_options: ["once"],
    });

    render(<ToolApprovalPromptCard streamKey="agent:a1:s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Runtime disconnected");
    expect(screen.getByText("Approval needed")).toBeDefined();
    expect(screen.getByRole("button", { name: "Deny" })).not.toBeDisabled();
  });
});
