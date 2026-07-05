import { describe, expect, it } from "vitest";
import { resolveWorkspaceAccess } from "./workspace-access";

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
});
