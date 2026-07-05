import { beforeEach, describe, expect, it } from "vitest";
import {
  __publicChatImportTestKeys,
  markPublicChatImported,
  readPendingPublicChatImports,
} from "./use-public-chat-import";

const { PUBLIC_CHAT_STATE_KEY, PUBLIC_CHAT_IMPORTS_KEY } =
  __publicChatImportTestKeys;

beforeEach(() => {
  window.localStorage.clear();
});

describe("public chat import helpers", () => {
  it("reads pending public sessions oldest-first and converts media turns", () => {
    window.localStorage.setItem(
      PUBLIC_CHAT_STATE_KEY,
      JSON.stringify({
        v: 2,
        guestToken: "guest",
        limit: 3,
        turnCount: 2,
        sessionOrder: ["newer", "older"],
        sessions: {
          newer: {
            id: "newer",
            title: "Newer chat",
            updatedAt: 2,
            turns: [
              { id: "u2", role: "user", content: "Make a logo" },
              {
                id: "a2",
                role: "assistant",
                mode: "image",
                prompt: "Make a logo",
                url: "https://cdn.example/logo.png",
              },
            ],
          },
          older: {
            id: "older",
            title: "Older chat",
            updatedAt: 1,
            turns: [
              { id: "u1", role: "user", content: "Explain Aura" },
              {
                id: "a1",
                role: "assistant",
                mode: "code",
                content: "Aura is chat plus build.",
              },
            ],
          },
        },
      }),
    );

    const pending = readPendingPublicChatImports(window.localStorage);

    expect(pending.map((session) => session.publicSessionId)).toEqual([
      "older",
      "newer",
    ]);
    expect(pending[0].turns).toEqual([
      { role: "user", content: "Explain Aura" },
      { role: "assistant", content: "Aura is chat plus build." },
    ]);
    expect(pending[1].turns[1]).toEqual({
      role: "assistant",
      content: "Generated image for: Make a logo\n\nhttps://cdn.example/logo.png",
    });
  });

  it("skips public sessions that have already been imported", () => {
    window.localStorage.setItem(
      PUBLIC_CHAT_STATE_KEY,
      JSON.stringify({
        v: 2,
        guestToken: null,
        limit: 3,
        turnCount: 1,
        sessionOrder: ["s1"],
        sessions: {
          s1: {
            id: "s1",
            title: "Already imported",
            updatedAt: 1,
            turns: [{ id: "u1", role: "user", content: "hello" }],
          },
        },
      }),
    );
    markPublicChatImported(
      "s1",
      { sessionId: "11111111-1111-1111-1111-111111111111" },
      window.localStorage,
    );

    expect(readPendingPublicChatImports(window.localStorage)).toEqual([]);
    const imports = JSON.parse(
      window.localStorage.getItem(PUBLIC_CHAT_IMPORTS_KEY) ?? "{}",
    );
    expect(imports).toMatchObject({
      v: 1,
      imported: {
        s1: {
          sessionId: "11111111-1111-1111-1111-111111111111",
        },
      },
    });
  });
});
