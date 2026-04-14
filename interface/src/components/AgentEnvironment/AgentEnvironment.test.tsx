import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
    vi.useRealTimers()
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
      previous_vm_id: "old-vm",
      vm_id: "vm-2",
      vm_id_changed: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
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
    expect((await screen.findAllByText("Recovery requested. Starting up...")).length).toBeGreaterThan(0)
  })

  it("shows an explicit message when follow-up refresh returns error again", async () => {
    swarmApiMocks.getRemoteAgentState
      .mockResolvedValueOnce({
        state: "error",
        uptime_seconds: 0,
        active_sessions: 0,
        error_message: "Machine failed",
        agent_id: "a1",
      })
      .mockResolvedValueOnce({
        state: "error",
        uptime_seconds: 0,
        active_sessions: 0,
        error_message: "Machine failed",
        agent_id: "a1",
      })

    const originalSetTimeout = window.setTimeout
    vi.spyOn(window, "setTimeout").mockImplementation((callback: TimerHandler, delay?: number) => {
      if (delay === 2_000 && typeof callback === "function") {
        callback()
        return 0 as unknown as number
      }
      return originalSetTimeout(callback, delay)
    })

    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))
    await user.click(await screen.findByRole("button", { name: "Recovery" }))

    await waitFor(() => {
      expect(
        screen.getByText("Recovery request succeeded, but the machine returned Error: Machine failed"),
      ).toBeInTheDocument()
    })
  })

  it("shows a warning when recovery keeps the same machine mapping", async () => {
    swarmApiMocks.recoverRemoteAgent.mockResolvedValueOnce({
      agent_id: "a1",
      status: "provisioning",
      previous_vm_id: "same-vm",
      vm_id: "same-vm",
      vm_id_changed: false,
      message: "Swarm accepted the recovery request but kept the same machine mapping.",
    })

    const user = userEvent.setup()

    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(swarmApiMocks.getRemoteAgentState).toHaveBeenCalledWith("a1")
    })

    await user.click(screen.getByRole("button", { name: "Remote" }))
    await user.click(await screen.findByRole("button", { name: "Manage" }))
    await user.click(await screen.findByRole("button", { name: "Recovery" }))

    await waitFor(() => {
      expect(
        screen.getByText("Swarm accepted the recovery request but kept the same machine mapping."),
      ).toBeInTheDocument()
    })
  })
})
