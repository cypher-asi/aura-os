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

const subscribeMock = vi.fn(() => vi.fn())

vi.mock("../../stores/event-store/index", () => ({
  useEventStore: (selector: (s: { subscribe: typeof subscribeMock }) => unknown) =>
    selector({ subscribe: subscribeMock }),
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
      status: "running",
      previous_vm_id: "old-vm",
      vm_id: "vm-2",
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
  })

  it("clears recovery notice when recovery returns running status", async () => {
    swarmApiMocks.recoverRemoteAgent.mockResolvedValueOnce({
      agent_id: "a1",
      status: "running",
      previous_vm_id: "old-vm",
      vm_id: "vm-new",
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
      expect(swarmApiMocks.recoverRemoteAgent).toHaveBeenCalledWith("a1")
    })
    expect(
      screen.queryByText("Recovery completed. The machine is available again."),
    ).not.toBeInTheDocument()
  })

  it("shows error notice when recovery API call fails", async () => {
    swarmApiMocks.recoverRemoteAgent.mockRejectedValueOnce(
      new Error("new machine entered error state after provisioning"),
    )

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
        screen.getByText("new machine entered error state after provisioning"),
      ).toBeInTheDocument()
    })
  })

  it("subscribes to WS events for real-time recovery updates", async () => {
    render(<AgentEnvironment machineType="remote" agentId="a1" />)

    await waitFor(() => {
      expect(subscribeMock).toHaveBeenCalledWith(
        "remote_agent_state_changed",
        expect.any(Function),
      )
    })
  })
})
