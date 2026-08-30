import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AttachmentItem } from "../features/chat-ui/ChatInputBar/ChatInputBar";
import {
  MAX_PROMPT_STASH_ENTRIES,
  PROMPT_STASH_STORAGE_KEY,
  restoreAttachments,
  snapshotAttachments,
  usePromptStashStore,
} from "./prompt-stash-store";

function attachment(name = "notes.txt"): AttachmentItem {
  return {
    id: `attachment-${name}`,
    file: new File(["hello"], name, { type: "text/plain" }),
    data: btoa("hello"),
    mediaType: "text/plain",
    name,
    attachmentType: "text",
  };
}

describe("prompt-stash-store", () => {
  beforeEach(() => {
    localStorage.clear();
    usePromptStashStore.setState({ entries: [] });
    vi.restoreAllMocks();
  });

  it("prepends and durably persists complete composer snapshots", () => {
    const first = usePromptStashStore.getState().stashDraft({
      prompt: "first",
      attachments: [attachment()],
      commands: [
        { id: "read_file", label: "Read File", description: "Read", category: "Core" },
      ],
    });
    const second = usePromptStashStore.getState().stashDraft({
      prompt: "second",
      attachments: [],
      commands: [],
    });

    expect(first.written).toBe(true);
    expect(second.written).toBe(true);
    expect(usePromptStashStore.getState().entries.map((entry) => entry.prompt)).toEqual([
      "second",
      "first",
    ]);
    expect(JSON.parse(localStorage.getItem(PROMPT_STASH_STORAGE_KEY) ?? "{}"))
      .toMatchObject({ version: 1 });
  });

  it("keeps only the newest entries at the shelf cap", () => {
    for (let index = 0; index <= MAX_PROMPT_STASH_ENTRIES; index += 1) {
      usePromptStashStore.getState().stashDraft({
        prompt: `prompt-${index}`,
        attachments: [],
        commands: [],
      });
    }
    const entries = usePromptStashStore.getState().entries;
    expect(entries).toHaveLength(MAX_PROMPT_STASH_ENTRIES);
    expect(entries[0]?.prompt).toBe(`prompt-${MAX_PROMPT_STASH_ENTRIES}`);
    expect(entries.at(-1)?.prompt).toBe("prompt-1");
  });

  it("does not mutate visible state when browser storage rejects a write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const result = usePromptStashStore.getState().stashDraft({
      prompt: "keep me",
      attachments: [],
      commands: [],
    });
    expect(result.written).toBe(false);
    expect(usePromptStashStore.getState().entries).toEqual([]);
  });

  it("round-trips attachment payloads into sendable File-backed items", () => {
    const snapshot = snapshotAttachments([attachment("context.txt")]);
    const [restored] = restoreAttachments(snapshot.attachments);
    expect(snapshot.droppedAttachmentNames).toEqual([]);
    expect(restored.name).toBe("context.txt");
    expect(restored.data).toBe(btoa("hello"));
    expect(restored.file).toBeInstanceOf(File);
  });

  it("hydrates valid entries and ignores malformed persisted rows", () => {
    localStorage.setItem(
      PROMPT_STASH_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "valid",
            createdAt: "2026-08-30T12:00:00Z",
            prompt: "restored",
            attachments: [],
            commands: [],
            droppedAttachmentNames: [],
          },
          { id: 7 },
        ],
      }),
    );
    usePromptStashStore.getState().hydrate();
    expect(usePromptStashStore.getState().entries.map((entry) => entry.id)).toEqual([
      "valid",
    ]);
  });
});
