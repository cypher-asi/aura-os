import {
  buildIdeNavigationState,
  resolveIdeReturnPath,
} from "./ide-navigation";

describe("IDE navigation", () => {
  it("captures the exact originating app route", () => {
    expect(
      buildIdeNavigationState(
        "/projects/project-1/agents/agent-1",
        "?panel=files",
        "#latest",
      ),
    ).toEqual({
      returnTo: "/projects/project-1/agents/agent-1?panel=files#latest",
    });
  });

  it("uses safe internal return paths", () => {
    expect(
      resolveIdeReturnPath({ returnTo: "/projects/project-1/files?sort=name" }),
    ).toBe("/projects/project-1/files?sort=name");
  });

  it.each(["https://example.com", "//example.com", "/ide", "/ide?file=x"])(
    "rejects unsafe or recursive return path %s",
    (returnTo) => {
      expect(
        resolveIdeReturnPath({ returnTo }, "/projects/project-1/files"),
      ).toBe("/projects/project-1/files");
    },
  );
});
