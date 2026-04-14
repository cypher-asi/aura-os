import { describe, expect, it } from "vitest";
import { buildCommitActivityFromEvents, getCommitCount } from "./commitActivity";

function toHourKey(timestamp: string): string {
  const date = new Date(timestamp);
  return `${timestamp.slice(0, 10)}:${String(date.getHours()).padStart(2, "0")}`;
}

describe("commitActivity", () => {
  it("falls back to commitIds when expanded commit metadata is missing", () => {
    const event = {
      postType: "push",
      timestamp: "2025-06-01T12:00:00Z",
      commits: [],
      commitIds: ["a1", "b2", "c3"],
    };

    expect(getCommitCount(event)).toBe(3);
    expect(buildCommitActivityFromEvents([event])).toEqual({
      [toHourKey(event.timestamp)]: 3,
    });
  });

  it("ignores non-push events and push events without any commit data", () => {
    const activity = buildCommitActivityFromEvents([
      {
        postType: "post",
        timestamp: "2025-06-01T12:00:00Z",
        commits: [{ sha: "abc" }],
        commitIds: ["abc"],
      },
      {
        postType: "push",
        timestamp: "2025-06-01T13:00:00Z",
        commits: [],
        commitIds: [],
      },
    ]);

    expect(activity).toEqual({});
  });
});
