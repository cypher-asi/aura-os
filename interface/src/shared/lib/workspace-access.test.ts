import { describe, expect, it } from "vitest";
import {
  canStartWorkspaceAutomation,
  resolveWorkspaceAccess,
} from "./workspace-access";

describe("resolveWorkspaceAccess", () => {
  it("allows local workspace access only when the desktop bridge is linked", () => {
    expect(
      resolveWorkspaceAccess({
        workspacePath: "/Users/demo/project",
        linkedWorkspace: true,
      }),
    ).toMatchObject({
      canUseWorkspace: true,
      canBrowseLocal: true,
      kind: "local",
      workspacePath: "/Users/demo/project",
    });
  });

  it("blocks local workspace access on web even when a local path is present", () => {
    expect(
      resolveWorkspaceAccess({
        workspacePath: "/Users/demo/project",
        linkedWorkspace: false,
      }),
    ).toMatchObject({
      canUseWorkspace: false,
      canBrowseLocal: false,
      kind: null,
      workspacePath: undefined,
    });
  });

  it("allows remote workspace access without the desktop bridge", () => {
    expect(
      resolveWorkspaceAccess({
        remoteAgentId: "agent-1",
        remoteWorkspacePath: "p/demo-project",
        workspacePath: "/ignored/local/path",
        linkedWorkspace: false,
      }),
    ).toMatchObject({
      canUseWorkspace: true,
      canBrowseRemote: true,
      kind: "remote",
      workspacePath: "p/demo-project",
    });
  });

  it("allows automation starts for local desktop workspaces without a remote instance id", () => {
    const access = resolveWorkspaceAccess({
      workspacePath: "/Users/demo/project",
      linkedWorkspace: true,
    });

    expect(canStartWorkspaceAutomation(access)).toBe(true);
  });

  it("requires a concrete remote instance id before remote automation can start", () => {
    const access = resolveWorkspaceAccess({
      remoteAgentId: "agent-1",
      remoteWorkspacePath: "p/demo-project",
      linkedWorkspace: false,
    });

    expect(canStartWorkspaceAutomation(access)).toBe(false);
    expect(canStartWorkspaceAutomation(access, "   ")).toBe(false);
    expect(canStartWorkspaceAutomation(access, "remote-inst-1")).toBe(true);
  });
});
