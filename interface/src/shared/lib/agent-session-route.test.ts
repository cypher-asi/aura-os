import { describe, expect, it } from "vitest";
import { buildAgentSessionRoute } from "./agent-session-route";

describe("buildAgentSessionRoute", () => {
  it("targets the exact project agent and session when all identities are known", () => {
    expect(
      buildAgentSessionRoute({
        projectId: "project-1",
        agentInstanceId: "instance-1",
        agentId: "agent-1",
        sessionId: "session-1",
      }),
    ).toBe("/projects/project-1/agents/instance-1?session=session-1");
  });

  it("falls back to the persistent agent route with resolver hints", () => {
    expect(
      buildAgentSessionRoute({
        projectId: "project one",
        agentId: "agent/one",
        sessionId: "session one",
      }),
    ).toBe("/agents/agent%2Fone?project=project+one&session=session+one");
  });

  it("returns undefined without an agent identity", () => {
    expect(buildAgentSessionRoute({ projectId: "project-1" })).toBeUndefined();
  });
});
