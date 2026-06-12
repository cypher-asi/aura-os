import { renderHook, act } from "@testing-library/react";
import { vi } from "vitest";
import { getTrailingTriggerQuery, useInputTriggers } from "./useInputTriggers";
import type { InputBarShellHandle } from "../../../components/InputBarShell";

describe("getTrailingTriggerQuery", () => {
  it("matches a trigger token under the cursor", () => {
    expect(getTrailingTriggerQuery("/rec", 4, "/")).toEqual({
      start: 0,
      query: "rec",
    });
    expect(getTrailingTriggerQuery("see @src/ma", 11, "@")).toEqual({
      start: 4,
      query: "src/ma",
    });
  });

  it("returns null when the token does not start with the trigger", () => {
    expect(getTrailingTriggerQuery("hello", 5, "/")).toBeNull();
    expect(getTrailingTriggerQuery("a /cmd done", 11, "/")).toBeNull();
  });

  it("stops the token scan at whitespace", () => {
    expect(getTrailingTriggerQuery("hello /wo", 9, "/")).toEqual({
      start: 6,
      query: "wo",
    });
  });
});

describe("useInputTriggers", () => {
  function makeShellRef(cursor: number) {
    const textarea = { selectionStart: cursor } as HTMLTextAreaElement;
    const handle: InputBarShellHandle = {
      focus: vi.fn(),
      blur: vi.fn(),
      getTextarea: () => textarea,
    };
    return { current: handle };
  }

  function setup(options: {
    input: string;
    cursor: number;
    canUseMentions?: boolean;
  }) {
    const onInputChange = vi.fn();
    const onSelectGenerationMode = vi.fn();
    const onCommandsChange = vi.fn();
    const addFileFromPath = vi.fn().mockResolvedValue(undefined);
    const shellRef = makeShellRef(options.cursor);
    const hook = renderHook(
      ({ input }: { input: string }) =>
        useInputTriggers({
          input,
          onInputChange,
          shellRef,
          canUseMentions: options.canUseMentions ?? true,
          selectedCommands: [],
          onCommandsChange,
          onSelectGenerationMode,
          addFileFromPath,
        }),
      { initialProps: { input: options.input } },
    );
    return {
      hook,
      onInputChange,
      onSelectGenerationMode,
      onCommandsChange,
      addFileFromPath,
    };
  }

  it("opens the slash menu when a /token is under the cursor and closes it when gone", () => {
    const { hook } = setup({ input: "", cursor: 4 });

    act(() => hook.result.current.handleInputChange("/rec"));
    expect(hook.result.current.slashMenuOpen).toBe(true);
    expect(hook.result.current.slashQuery).toBe("rec");

    // Token removed (e.g. backspaced past the trigger) → menu closes.
    act(() => hook.result.current.handleInputChange("rec "));
    expect(hook.result.current.slashMenuOpen).toBe(false);
    expect(hook.result.current.slashQuery).toBe("");
  });

  it("opens the mention menu and bumps the refresh nonce only on the closed-to-open transition", () => {
    const { hook } = setup({ input: "", cursor: 3 });

    act(() => hook.result.current.handleInputChange("@sr"));
    expect(hook.result.current.mentionMenuOpen).toBe(true);
    expect(hook.result.current.mentionQuery).toBe("sr");
    const nonce = hook.result.current.mentionRefreshNonce;

    act(() => hook.result.current.handleInputChange("@src"));
    expect(hook.result.current.mentionRefreshNonce).toBe(nonce);
  });

  it("ignores @ tokens when mentions are not armed", () => {
    const { hook } = setup({ input: "", cursor: 3, canUseMentions: false });

    act(() => hook.result.current.handleInputChange("@sr"));
    expect(hook.result.current.mentionMenuOpen).toBe(false);
  });

  it("routes generation commands to the mode selector and strips the token", () => {
    const { hook, onInputChange, onSelectGenerationMode, onCommandsChange } =
      setup({ input: "/ima", cursor: 4 });

    act(() => hook.result.current.handleInputChange("/ima"));
    hook.rerender({ input: "/ima" });
    act(() =>
      hook.result.current.handleCommandSelect({
        id: "generate_image",
        label: "Image",
      } as never),
    );

    expect(onSelectGenerationMode).toHaveBeenCalledWith("image");
    expect(onCommandsChange).not.toHaveBeenCalled();
    expect(onInputChange).toHaveBeenLastCalledWith("");
    expect(hook.result.current.slashMenuOpen).toBe(false);
  });

  it("adds non-generation commands as chips", () => {
    const { hook, onCommandsChange } = setup({ input: "/rec", cursor: 4 });

    act(() => hook.result.current.handleInputChange("/rec"));
    hook.rerender({ input: "/rec" });
    const cmd = { id: "record_demo", label: "Record Demo" };
    act(() => hook.result.current.handleCommandSelect(cmd as never));

    expect(onCommandsChange).toHaveBeenCalledWith([cmd]);
  });

  it("strips the @token and attaches the picked file on mention select", () => {
    const { hook, onInputChange, addFileFromPath } = setup({
      input: "read @ma please",
      cursor: 8,
    });

    act(() => hook.result.current.handleInputChange("read @ma please"));
    hook.rerender({ input: "read @ma please" });
    act(() =>
      hook.result.current.handleMentionSelect({
        path: "src/main.rs",
        name: "main.rs",
      }),
    );

    expect(onInputChange).toHaveBeenLastCalledWith("read please");
    expect(addFileFromPath).toHaveBeenCalledWith("src/main.rs");
    expect(hook.result.current.mentionMenuOpen).toBe(false);
  });

  it("blocks menu navigation keys from reaching the shell while a menu is open", () => {
    const { hook } = setup({ input: "", cursor: 1 });

    act(() => hook.result.current.handleInputChange("/"));
    const event = {
      key: "Enter",
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLTextAreaElement>;
    hook.result.current.handleTextareaKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
