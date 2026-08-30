import { act, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlashCommand } from "../../../../constants/commands";
import type { AttachmentItem } from "../ChatInputBar";
import { usePromptStashStore } from "../../../../stores/prompt-stash-store";
import { usePromptStashComposer } from "./usePromptStashComposer";

const command: SlashCommand = {
  id: "read_file",
  label: "Read File",
  description: "Read",
  category: "Core",
};

function attachment(): AttachmentItem {
  return {
    id: "a1",
    file: new File(["hello"], "notes.txt", { type: "text/plain" }),
    data: btoa("hello"),
    mediaType: "text/plain",
    name: "notes.txt",
    attachmentType: "text",
  };
}

function useHarness(initialInput: string) {
  const [input, setInput] = useState(initialInput);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([attachment()]);
  const [commands, setCommands] = useState<SlashCommand[]>([command]);
  const focus = useCallback(() => {}, []);
  const shelf = usePromptStashComposer({
    input,
    onInputChange: setInput,
    attachments,
    onAttachmentsChange: setAttachments,
    commands,
    onCommandsChange: setCommands,
    focus,
  });
  return { input, attachments, commands, shelf, setInput };
}

describe("usePromptStashComposer", () => {
  beforeEach(() => {
    localStorage.clear();
    usePromptStashStore.setState({ entries: [] });
    vi.restoreAllMocks();
  });

  it("clears the composer only after a durable snapshot succeeds", () => {
    const { result } = renderHook(() => useHarness("unfinished prompt"));
    act(() => result.current.shelf.stashCurrent());

    expect(result.current.input).toBe("");
    expect(result.current.attachments).toEqual([]);
    expect(result.current.commands).toEqual([]);
    expect(result.current.shelf.entries[0]).toMatchObject({
      prompt: "unfinished prompt",
      commands: [{ id: "read_file" }],
    });
  });

  it("restores by appending to the current draft and merging attachments and commands", () => {
    const { result } = renderHook(() => useHarness("saved prompt"));
    act(() => result.current.shelf.stashCurrent());
    const saved = result.current.shelf.entries[0];
    act(() => result.current.setInput("current work"));

    act(() => result.current.shelf.restoreEntry(saved));

    expect(result.current.input).toBe("current work\n\nsaved prompt");
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]?.name).toBe("notes.txt");
    expect(result.current.commands).toEqual([command]);
    expect(result.current.shelf.entries).toEqual([]);
  });

  it("keeps the draft intact and opens an error when persistence fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const { result } = renderHook(() => useHarness("do not lose"));
    act(() => result.current.shelf.stashCurrent());

    expect(result.current.input).toBe("do not lose");
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.shelf.open).toBe(true);
    expect(result.current.shelf.error).toContain("left unchanged");
  });
});
