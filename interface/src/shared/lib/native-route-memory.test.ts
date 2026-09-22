import {
  normalizeRestorableNativeRoute,
  readNativeRouteMemory,
  resolveNativeInitialRoute,
  writeNativeRouteMemory,
} from "./native-route-memory";

describe("native route memory", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips an exact canonical agent session for the same user", () => {
    const route = "/agents/agent-1?project=p1&instance=i1&session=s1&view=details";
    writeNativeRouteMemory("user-1", route);

    expect(readNativeRouteMemory("user-1")).toBe(route);
    expect(resolveNativeInitialRoute("user-1", "/")).toBe(route);
    expect(readNativeRouteMemory("user-2")).toBeNull();
  });

  it("does not replace an explicit launch route", () => {
    writeNativeRouteMemory("user-1", "/projects/p1/files?session=s1");
    expect(resolveNativeInitialRoute("user-1", "/agents/notification-target")).toBeNull();
  });

  it("rejects public, external, malformed, and oversized routes", () => {
    expect(normalizeRestorableNativeRoute("https://evil.example/agents/a1")).toBeNull();
    expect(normalizeRestorableNativeRoute("//evil.example/agents/a1")).toBeNull();
    expect(normalizeRestorableNativeRoute("/login?next=/agents/a1")).toBeNull();
    expect(normalizeRestorableNativeRoute("/pricing")).toBeNull();
    expect(normalizeRestorableNativeRoute(`/agents/${"a".repeat(2_100)}`)).toBeNull();
  });

  it("preserves query and hash only for authenticated shell routes", () => {
    expect(normalizeRestorableNativeRoute(" /projects/p1/files?view=changes#diff ")).toBe(
      "/projects/p1/files?view=changes#diff",
    );
    expect(normalizeRestorableNativeRoute("/agents-publicity")).toBeNull();
  });
});
