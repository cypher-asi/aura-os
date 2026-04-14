import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { AgentEnvironment } from "./AgentEnvironment"

const swarmApiMocks = vi.hoisted(() => ({
  getRemoteAgentState: vi.fn(),
  remoteAgentAction: vi.fn(),
  recoverRemoteAgent: vi.fn(),
}))

vi.mock("../../api/client", () => ({
  api: {
    swarm: {
      getRemoteAgentState: swarmApiMocks.getRemoteAgentState,
      remoteAgentAction: swarmApiMocks.remoteAgentAction,
      recoverRemoteAgent: swarmApiMocks.recoverRemoteAgent,
    },
  },
}))

vi.mock("../../hooks/use-environment-info", () => ({
  useEnvironmentInfo: () => ({ data: null }),
}))

vi.mock("../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ isLocal: false, status: "idle" }),
}))

describe("AgentEnvironment", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    swarmApiMocks.getRemoteAgentState.mockResolvedValue({
      state: "error",
      uptime_seconds: 0,
      active_sessions: 0,
      error_message: "Machine failed",
      agent_id: "a1",
    })
    swarmApiMocks.remoteAgentAction.mockResolvedValue({ agent_id: "a1", status: "stopped" })
    swarmApiMocks.recoverRemoteAgent.mockResolvedValue({
      agent_id: "a1",
      status: "provisioning",
      vm_id: "vm-2",
    })
  })

  it("shows Recovery for errored remote machines and calls recover endpoint", async () => {
    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))

    const recoveryButton = await screen.findByRole("button", { name: "Recovery" })
    expect(recoveryButton).toHaveAttribute("data-variant", "danger")

    await user.click(recoveryButton)

    await waitFor(() => {
      expect(swarmApiMocks.recoverRemoteAgent).toHaveBeenCalledWith("a1")
    })
    expect(swarmApiMocks.remoteAgentAction).not.toHaveBeenCalled()
  })
})
