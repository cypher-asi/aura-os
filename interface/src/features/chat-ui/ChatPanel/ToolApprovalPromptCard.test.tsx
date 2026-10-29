import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it.each([
    "npm test -- --runInBand",
    "  printf '%s\\n' 'héllo 世界'\n git diff -- src/main.ts  ",
    "echo '<img src=x onerror=alert(1)>'",
    `printf '%s' '${"long-value/".repeat(500)}'`,
  ])("shows the exact command before disclosure or approval (%s)", async (command) => {
    respondToToolApproval.mockResolvedValue({ accepted: true });
    useToolApprovalStore.getState().setPrompt("agent:a1:s1", {
      request_id: "approval-command", tool_name: "run_command",
      args: { command, description: "A harmless summary", cwd: "/workspace" },
      agent_id: "a1", remember_options: ["once", "session"],
    });
    const { container } = render(<ToolApprovalPromptCard streamKey="agent:a1:s1" />);
    const preview = screen.getByRole("region", { name: "Command to run" });
    expect(within(preview).getByLabelText("Full command").textContent).toBe(command);
    expect(preview.closest("details")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(screen.getByText("A harmless summary", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Allow" }));
    await waitFor(() => expect(respondToToolApproval).toHaveBeenCalledWith("approval-command", "on", "once"));
  });

  it.each([null, {}, { command: " \n " }, { command: ["npm", "test"] }, { command: 42 }])("keeps non-command payloads in the full request (%j)", (args) => {
    useToolApprovalStore.getState().setPrompt("agent:a1:s1", {
      request_id: "approval-args", tool_name: "run_command", args,
      agent_id: "a1", remember_options: ["once"],
    });
    render(<ToolApprovalPromptCard streamKey="agent:a1:s1" />);
    expect(screen.queryByRole("region", { name: "Command to run" })).toBeNull();
    expect(screen.getByRole("button", { name: "Allow" })).toBeEnabled();
  });

  it("does not relabel a different tool's command-shaped parameter as shell execution", () => {
    useToolApprovalStore.getState().setPrompt("agent:a1:s1", {
      request_id: "approval-other", tool_name: "write_file", args: { command: "configuration value" },
      agent_id: "a1", remember_options: ["once"],
    });
    render(<ToolApprovalPromptCard streamKey="agent:a1:s1" />);
    expect(screen.queryByRole("region", { name: "Command to run" })).toBeNull();
    expect(screen.getByText(/configuration value/)).toBeInTheDocument();
  });
});
