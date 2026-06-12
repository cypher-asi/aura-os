import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTerminalLineHistory } from "./terminalLineHistory";
import { useTerminalHistoryStore } from "../../stores/terminal-history-store";

const KEY = "proj-1";
const BS = "\x7f";

function setup() {
  const write = vi.fn<(data: string) => void>();
  const ctrl = createTerminalLineHistory({ getHistoryKey: () => KEY, write });
  return { write, ctrl };
}

function type(ctrl: ReturnType<typeof setup>["ctrl"], text: string) {
  for (const ch of text) ctrl.onData(ch);
}

beforeEach(() => {
  useTerminalHistoryStore.setState({ historyByKey: {} });
});

describe("terminalLineHistory capture", () => {
  it("commits the trimmed line to project history on Enter", () => {
    const { ctrl } = setup();
    type(ctrl, "  ls -la  ");
    ctrl.onData("\r");
    expect(useTerminalHistoryStore.getState().getHistory(KEY)).toEqual(["ls -la"]);
  });

  it("ignores blank submissions", () => {
    const { ctrl } = setup();
    type(ctrl, "   ");
    ctrl.onData("\r");
    expect(useTerminalHistoryStore.getState().getHistory(KEY)).toEqual([]);
  });

  it("skips consecutive duplicate commands", () => {
    const { ctrl } = setup();
    type(ctrl, "ls");
    ctrl.onData("\r");
    type(ctrl, "ls");
    ctrl.onData("\r");
    expect(useTerminalHistoryStore.getState().getHistory(KEY)).toEqual(["ls"]);
  });

  it("ignores escape sequences (e.g. unsuppressed arrow keys)", () => {
    const { ctrl } = setup();
    type(ctrl, "ec");
    ctrl.onData("\x1b[D"); // ArrowLeft escape sequence — must not append "[D"
    type(ctrl, "ho");
    ctrl.onData("\r");
    expect(useTerminalHistoryStore.getState().getHistory(KEY)).toEqual(["echo"]);
  });

  it("accounts for Backspace when committing", () => {
    const { ctrl } = setup();
    type(ctrl, "lss");
    ctrl.onData(BS);
    ctrl.onData("\r");
    expect(useTerminalHistoryStore.getState().getHistory(KEY)).toEqual(["ls"]);
  });
});

describe("terminalLineHistory navigation", () => {
  it("does nothing on Arrow Up when history is empty", () => {
    const { ctrl, write } = setup();
    ctrl.handleArrow("up");
    expect(write).not.toHaveBeenCalled();
  });

  it("recalls previous commands and erases the current line first", () => {
    const { ctrl, write } = setup();
    type(ctrl, "first");
    ctrl.onData("\r");
    type(ctrl, "second");
    ctrl.onData("\r");

    // Draft in progress when navigation starts.
    type(ctrl, "xy");
    write.mockClear();

    ctrl.handleArrow("up"); // newest -> "second", erase 2 draft chars
    expect(write).toHaveBeenLastCalledWith(`${BS}${BS}second`);

    ctrl.handleArrow("up"); // -> "first", erase "second" (6 chars)
    expect(write).toHaveBeenLastCalledWith(`${BS.repeat(6)}first`);

    ctrl.handleArrow("up"); // already oldest -> no further write
    const callsAfterOldest = write.mock.calls.length;
    ctrl.handleArrow("up");
    expect(write.mock.calls.length).toBe(callsAfterOldest);
  });

  it("restores the saved draft when paging back past the newest entry", () => {
    const { ctrl, write } = setup();
    type(ctrl, "cmd");
    ctrl.onData("\r");

    type(ctrl, "draft");
    write.mockClear();

    ctrl.handleArrow("up"); // -> "cmd", erase "draft" (5)
    expect(write).toHaveBeenLastCalledWith(`${BS.repeat(5)}cmd`);

    ctrl.handleArrow("down"); // past newest -> restore "draft", erase "cmd" (3)
    expect(write).toHaveBeenLastCalledWith(`${BS.repeat(3)}draft`);
  });

  it("ignores Arrow Down when not navigating", () => {
    const { ctrl, write } = setup();
    type(ctrl, "cmd");
    ctrl.onData("\r");
    type(ctrl, "abc");
    write.mockClear();
    ctrl.handleArrow("down");
    expect(write).not.toHaveBeenCalled();
  });
});
