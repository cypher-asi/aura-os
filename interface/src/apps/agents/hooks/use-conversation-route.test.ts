import { describe, expect, it } from "vitest";

import { parseConversationRoute } from "./use-conversation-route";

describe("parseConversationRoute", () => {
  it("recognizes a standalone agent chat with canonical session identity", () => {
    expect(parseConversationRoute(
      "/agents/agent-1",
      "?project=project-1&instance=instance-1&session=session-1",
    )).toEqual({
      isConversationRoute: true,
      agentId: "agent-1",
      sessionId: "session-1",
      queryProjectId: "project-1",
      queryInstanceId: "instance-1",
    });
  });

  it("treats the standalone details view as chrome around a hidden chat", () => {
    expect(parseConversationRoute(
      "/agents/agent-1",
      "?project=project-1&instance=instance-1&session=session-1&view=details",
    )).toEqual({
      isConversationRoute: false,
      sessionId: "session-1",
      queryProjectId: "project-1",
      queryInstanceId: "instance-1",
    });
  });
});
