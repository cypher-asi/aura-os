import { useTerminalHistoryStore } from "../../stores/terminal-history-store";

/**
 * Per-terminal input-line model + project-history navigation.
 *
 * The terminal forwards raw keystrokes straight to the shell, so to capture
 * "sent commands" and to drive Arrow Up/Down through a shared project history
 * we maintain a small heuristic model of the current input line:
 *
 *  - printable keystrokes append to the buffer
 *  - Backspace removes the last char
 *  - Enter commits the trimmed buffer to the project history store
 *  - Ctrl+C / Ctrl+U discard the line (shells clear the prompt)
 *
 * Navigation replaces the shell's current line by emitting Backspaces for the
 * tracked buffer length followed by the recalled command. This assumes the
 * cursor sits at the end of the line; mid-line cursor edits or advanced
 * PSReadLine editing can make the model imperfect, which is an accepted
 * trade-off for a cross-shell, frontend-only history layer.
 */

const BACKSPACE = "\x7f";
const ENTER = ["\r", "\n"];
const DISCARD = ["\x03", "\x15"]; // Ctrl+C, Ctrl+U

export interface TerminalLineHistory {
  /** Feed every chunk that the user types (before it reaches the PTY). */
  onData(data: string): void;
  /** Drive Arrow Up/Down navigation; injects the recalled command. */
  handleArrow(direction: "up" | "down"): void;
}

export function createTerminalLineHistory(opts: {
  getHistoryKey: () => string;
  write: (data: string) => void;
}): TerminalLineHistory {
  let buffer = "";
  // Index into the history snapshot while navigating; null means the user is
  // editing their own (un-recalled) draft line.
  let navIndex: number | null = null;
  // The in-progress line saved when navigation begins, restored on the way back.
  let draft = "";

  const reset = () => {
    buffer = "";
    navIndex = null;
    draft = "";
  };

  const onData = (data: string) => {
    // Escape sequences (arrows, Home/End, function keys, …) start with ESC and
    // are not part of the typed command — skip the whole chunk so we don't
    // append stray bytes like "[D" to the buffer. Arrow keys are already
    // suppressed upstream, but other control keys still reach onData.
    if (data.charCodeAt(0) === 0x1b) return;

    for (const ch of data) {
      if (ENTER.includes(ch)) {
        const cmd = buffer.trim();
        if (cmd) {
          useTerminalHistoryStore.getState().pushCommand(opts.getHistoryKey(), cmd);
        }
        reset();
      } else if (ch === BACKSPACE || ch === "\b") {
        buffer = buffer.slice(0, -1);
        navIndex = null;
      } else if (DISCARD.includes(ch)) {
        reset();
      } else if (ch >= " ") {
        buffer += ch;
        navIndex = null;
      }
      // Other control characters are ignored for line-model purposes.
    }
  };

  const replaceLine = (next: string) => {
    const erase = BACKSPACE.repeat(buffer.length);
    opts.write(erase + next);
    buffer = next;
  };

  const handleArrow = (direction: "up" | "down") => {
    const history = useTerminalHistoryStore.getState().getHistory(opts.getHistoryKey());
    if (history.length === 0) return;

    if (direction === "up") {
      if (navIndex === null) {
        draft = buffer;
        navIndex = history.length - 1;
      } else if (navIndex > 0) {
        navIndex -= 1;
      } else {
        return; // already at the oldest entry
      }
      replaceLine(history[navIndex]);
      return;
    }

    // direction === "down"
    if (navIndex === null) return; // not navigating: leave the draft untouched
    if (navIndex < history.length - 1) {
      navIndex += 1;
      replaceLine(history[navIndex]);
    } else {
      navIndex = null;
      replaceLine(draft);
    }
  };

  return { onData, handleArrow };
}
