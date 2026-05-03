import { afterEach, describe, expect, it } from "vitest";
import { getXtermTheme } from "./getXtermTheme";

const VAR_NAMES = [
  "--color-terminal-bg",
  "--color-terminal-fg",
  "--color-terminal-cursor",
  "--color-terminal-cursor-accent",
  "--color-terminal-selection-bg",
  "--color-terminal-selection-inactive-bg",
  "--color-terminal-ansi-black",
  "--color-terminal-ansi-red",
  "--color-terminal-ansi-green",
  "--color-terminal-ansi-yellow",
  "--color-terminal-ansi-blue",
  "--color-terminal-ansi-magenta",
  "--color-terminal-ansi-cyan",
  "--color-terminal-ansi-white",
  "--color-terminal-ansi-bright-black",
  "--color-terminal-ansi-bright-red",
  "--color-terminal-ansi-bright-green",
  "--color-terminal-ansi-bright-yellow",
  "--color-terminal-ansi-bright-blue",
  "--color-terminal-ansi-bright-magenta",
  "--color-terminal-ansi-bright-cyan",
  "--color-terminal-ansi-bright-white",
];

function setVar(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function clearAllVars() {
  for (const name of VAR_NAMES) {
    document.documentElement.style.removeProperty(name);
  }
}

afterEach(() => {
  clearAllVars();
});

describe("getXtermTheme", () => {
  it("maps CSS variables to xterm theme keys (dark)", () => {
    setVar("--color-terminal-bg", "#101820");
    setVar("--color-terminal-fg", "#abcdef");
    setVar("--color-terminal-cursor", "#ff00ff");
    setVar("--color-terminal-cursor-accent", "#00ffff");
    setVar("--color-terminal-selection-bg", "#123456");
    setVar("--color-terminal-selection-inactive-bg", "rgba(18, 52, 86, 0.5)");
    setVar("--color-terminal-ansi-black", "#010101");
    setVar("--color-terminal-ansi-red", "#020202");
    setVar("--color-terminal-ansi-green", "#030303");
    setVar("--color-terminal-ansi-yellow", "#040404");
    setVar("--color-terminal-ansi-blue", "#050505");
    setVar("--color-terminal-ansi-magenta", "#060606");
    setVar("--color-terminal-ansi-cyan", "#070707");
    setVar("--color-terminal-ansi-white", "#080808");
    setVar("--color-terminal-ansi-bright-black", "#111111");
    setVar("--color-terminal-ansi-bright-red", "#121212");
    setVar("--color-terminal-ansi-bright-green", "#131313");
    setVar("--color-terminal-ansi-bright-yellow", "#141414");
    setVar("--color-terminal-ansi-bright-blue", "#151515");
    setVar("--color-terminal-ansi-bright-magenta", "#161616");
    setVar("--color-terminal-ansi-bright-cyan", "#171717");
    setVar("--color-terminal-ansi-bright-white", "#181818");

    const theme = getXtermTheme("dark");

    expect(theme.background).toBe("#101820");
    expect(theme.foreground).toBe("#abcdef");
    expect(theme.cursor).toBe("#ff00ff");
    expect(theme.cursorAccent).toBe("#00ffff");
    expect(theme.selectionBackground).toBe("#123456");
    expect(theme.selectionInactiveBackground).toBe("rgba(18, 52, 86, 0.5)");
    expect(theme.black).toBe("#010101");
    expect(theme.red).toBe("#020202");
    expect(theme.green).toBe("#030303");
    expect(theme.yellow).toBe("#040404");
    expect(theme.blue).toBe("#050505");
    expect(theme.magenta).toBe("#060606");
    expect(theme.cyan).toBe("#070707");
    expect(theme.white).toBe("#080808");
    expect(theme.brightBlack).toBe("#111111");
    expect(theme.brightRed).toBe("#121212");
    expect(theme.brightGreen).toBe("#131313");
    expect(theme.brightYellow).toBe("#141414");
    expect(theme.brightBlue).toBe("#151515");
    expect(theme.brightMagenta).toBe("#161616");
    expect(theme.brightCyan).toBe("#171717");
    expect(theme.brightWhite).toBe("#181818");
  });

  it("maps CSS variables independently of the resolved arg (light)", () => {
    setVar("--color-terminal-bg", "#fafafa");
    setVar("--color-terminal-fg", "#222222");
    setVar("--color-terminal-cursor", "#333333");

    const theme = getXtermTheme("light");

    expect(theme.background).toBe("#fafafa");
    expect(theme.foreground).toBe("#222222");
    expect(theme.cursor).toBe("#333333");
  });

  it("returns the dark fallback palette when no vars are set", () => {
    const theme = getXtermTheme("dark");

    expect(theme.background).toBe("#1e1e1e");
    expect(theme.foreground).toBe("#cccccc");
    expect(theme.cursor).toBe("#aeafad");
    expect(theme.cursorAccent).toBe("#1e1e1e");
    expect(theme.selectionBackground).toBe("#264f78");
    expect(theme.black).toBe("#000000");
    expect(theme.red).toBe("#cd3131");
    expect(theme.green).toBe("#0dbc79");
    expect(theme.brightWhite).toBe("#e5e5e5");
  });

  it("returns the light fallback palette when no vars are set", () => {
    const theme = getXtermTheme("light");

    expect(theme.background).toBe("#ffffff");
    expect(theme.foreground).toBe("#1f2937");
    expect(theme.cursor).toBe("#374151");
    expect(theme.cursorAccent).toBe("#ffffff");
    expect(theme.selectionBackground).toBe("#bfdbfe");
    expect(theme.black).toBe("#000000");
    expect(theme.green).toBe("#00bc00");
    expect(theme.brightWhite).toBe("#a5a5a5");
  });
});
