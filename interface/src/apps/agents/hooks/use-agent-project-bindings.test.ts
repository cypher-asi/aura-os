import { describe, expect, it } from "vitest";
import { dedupeProjectBindings } from "./use-agent-project-bindings";

describe("dedupeProjectBindings", () => {
  it("keeps one routable binding per project", () => {
    expect(
      dedupeProjectBindings([
        { project_agent_id: "pa-1", project_id: "p-1", project_name: "One" },
        { project_agent_id: "pa-2", project_id: "p-1", project_name: "One duplicate" },
        { project_agent_id: "pa-3", project_id: "p-2", project_name: "Two" },
      ]),
    ).toEqual([
      { project_agent_id: "pa-1", project_id: "p-1", project_name: "One" },
      { project_agent_id: "pa-3", project_id: "p-2", project_name: "Two" },
    ]);
  });
});
