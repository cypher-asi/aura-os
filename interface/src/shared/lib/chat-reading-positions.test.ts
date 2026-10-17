import { beforeEach, describe, expect, it } from "vitest";
import { clearChatPositions, followChatPosition, readChatPosition, rememberChatPosition } from "./chat-reading-positions";

describe("chat reading positions", () => {
  beforeEach(clearChatPositions);
  const position = { rowId: "message-1", offsetWithinRow: 12, scrollOffset: 512, atEnd: false };
  it("isolates transcript keys and clears session memory", () => {
    rememberChatPosition("project:one:session:a", position);
    expect(readChatPosition("project:one:session:b")).toBeUndefined();
    expect(readChatPosition("project:two:session:a")).toBeUndefined();
    expect(readChatPosition("project:one:session:a")).toEqual(position);
    clearChatPositions();
    expect(readChatPosition("project:one:session:a")).toBeUndefined();
  });
  it("bounds memory to 100 recently saved positions", () => {
    for (let i = 0; i < 100; i++) rememberChatPosition(String(i), position);
    rememberChatPosition("0", position);
    rememberChatPosition("100", position);
    expect(readChatPosition("0")).toEqual(position);
    expect(readChatPosition("1")).toBeUndefined();
  });
  it("explicitly following cancels a remembered reading position", () => {
    rememberChatPosition("one", position);
    followChatPosition("one");
    expect(readChatPosition("one")?.atEnd).toBe(true);
  });
});
