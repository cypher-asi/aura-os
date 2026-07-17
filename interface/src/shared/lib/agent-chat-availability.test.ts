import { describe, expect, it } from "vitest";

import { resolveAgentChatAvailability } from "./agent-chat-availability";

describe("resolveAgentChatAvailability", () => {
  it("keeps local agents available without a remote VM status", () => {
    expect(resolveAgentChatAvailability("local", undefined)).toEqual({
      available: true,
      label: "Online",
    });
  });

  it.each(["running", "working", "RUNNING"])(
    "allows a remote agent in the %s state",
    (status) => {
      expect(resolveAgentChatAvailability("remote", status).available).toBe(true);
    },
  );

  it.each([
    [undefined, "Checking status"],
    ["provisioning", "Starting"],
    ["hibernating", "Hibernating"],
    ["stopping", "Stopping"],
    ["stopped", "Offline"],
    ["error", "Unavailable"],
  ])("blocks a remote agent in the %s state", (status, label) => {
    expect(resolveAgentChatAvailability("remote", status)).toMatchObject({
      available: false,
      label,
    });
  });
});
