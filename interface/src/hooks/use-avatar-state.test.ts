import { renderHook } from "@testing-library/react";

let mockStatuses: Record<string, string> = {};
let mockMachineTypes: Record<string, string> = {};

vi.mock("../stores/profile-status-store", () => ({
  useProfileStatusStore: (selector: (s: { statuses: Record<string, string>; machineTypes: Record<string, string> }) => unknown) =>
    selector({ statuses: mockStatuses, machineTypes: mockMachineTypes }),
}));

import { useAvatarState } from "./use-avatar-state";

describe("useAvatarState", () => {
  beforeEach(() => {
    mockStatuses = {};
    mockMachineTypes = {};
  });

  it("returns undefined status and local defaults when id is undefined", () => {
    const { result } = renderHook(() => useAvatarState(undefined));

    expect(result.current.status).toBe("idle");
    expect(result.current.machineType).toBe("local");
    expect(result.current.isLocal).toBe(true);
  });

  it("returns idle status for local agent with no explicit status", () => {
    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBe("idle");
    expect(result.current.machineType).toBe("local");
    expect(result.current.isLocal).toBe(true);
  });

  it("normalizes running status", () => {
    mockStatuses = { "agent-1": "Running" };
    mockMachineTypes = { "agent-1": "remote" };

    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBe("running");
    expect(result.current.machineType).toBe("remote");
    expect(result.current.isLocal).toBe(false);
  });

  it("normalizes working to running", () => {
    mockStatuses = { "agent-1": "working" };

    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBe("running");
  });

  it("maps blocked to error", () => {
    mockStatuses = { "agent-1": "blocked" };

    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBe("error");
  });

  it("passes through unmapped status values", () => {
    mockStatuses = { "agent-1": "custom_status" };

    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBe("custom_status");
  });

  it("returns undefined status for remote agent with no status", () => {
    mockMachineTypes = { "agent-1": "remote" };

    const { result } = renderHook(() => useAvatarState("agent-1"));

    expect(result.current.status).toBeUndefined();
    expect(result.current.isLocal).toBe(false);
  });

  it("handles all known status values", () => {
    const mapping: [string, string][] = [
      ["running", "running"],
      ["idle", "idle"],
      ["provisioning", "provisioning"],
      ["hibernating", "hibernating"],
      ["stopping", "stopping"],
      ["stopped", "stopped"],
      ["error", "error"],
    ];

    for (const [input, expected] of mapping) {
      mockStatuses = { "a": input };
      const { result } = renderHook(() => useAvatarState("a"));
      expect(result.current.status).toBe(expected);
    }
  });
});
