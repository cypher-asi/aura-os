import { describe, expect, it } from "vitest";
import { extractInternalPushRoute } from "./use-native-push-notifications";

describe("extractInternalPushRoute", () => {
  it("keeps the canonical agent session route", () => {
    expect(
      extractInternalPushRoute({
        route: "/projects/project-1/agents/instance-1?session=session-1",
      }),
    ).toBe("/projects/project-1/agents/instance-1?session=session-1");
  });

  it("rejects external and protocol-relative destinations", () => {
    expect(extractInternalPushRoute({ route: "https://evil.example/x" })).toBeNull();
    expect(extractInternalPushRoute({ route: "//evil.example/x" })).toBeNull();
  });

  it("rejects missing or malformed data", () => {
    expect(extractInternalPushRoute(null)).toBeNull();
    expect(extractInternalPushRoute({ route: 42 })).toBeNull();
  });
});
