import { describe, expect, it } from "vitest";
import { buildCommitActivityFromEvents, getCommitCount } from "./commitActivity";

function toHourKey(timestamp: string): string {
  const date = new Date(timestamp);
  return `${timestamp.slice(0, 10)}:${String(date.getHours()).padStart(2, "0")}`;
}

describe("commitActivity", () => {
  it("falls back to commitIds when expanded commit metadata is missing", () => {
    const event = {
      timestamp: "2025-06-01T12:00:00Z",
      commits: [],
      commitIds: ["a1", "b2", "c3"],
    };

    expect(getCommitCount(event)).toBe(3);
    expect(buildCommitActivityFromEvents([event])).toEqual({
      [toHourKey(event.timestamp)]: 3,
    });
  });

  it("counts events with commit data regardless of post type", () => {
    const postEvent = {
      timestamp: "2025-06-01T12:00:00Z",
      commits: [{ sha: "abc" }],
      commitIds: ["abc"],
    };
    const otherEvent = {
      timestamp: "2025-06-01T14:00:00Z",
      commits: [],
      commitIds: ["x1", "x2"],
    };

    const activity = buildCommitActivityFromEvents([postEvent, otherEvent]);

    expect(activity).toEqual({
      [toHourKey(postEvent.timestamp)]: 1,
      [toHourKey(otherEvent.timestamp)]: 2,
    });
  });

  it("ignores events without any commit data", () => {
    const activity = buildCommitActivityFromEvents([
      {
        timestamp: "2025-06-01T13:00:00Z",
        commits: [],
        commitIds: [],
      },
      {
        timestamp: "2025-06-01T14:00:00Z",
        commits: [],
      },
    ]);

    expect(activity).toEqual({});
  });
});
