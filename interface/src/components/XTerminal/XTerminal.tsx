import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import type { UseTerminalReturn } from "../../hooks/use-terminal";
import styles from "./XTerminal.module.css";

interface XTerminalProps {
  terminal: UseTerminalReturn;
  visible: boolean;
  focused: boolean;
}

function getThemeBg(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#111";
}

function getThemeColor(variable: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || fallback;
}

function getTheme() {
  const background = getThemeBg();
  const appGreen = getThemeColor("--color-success", "#4aeaa8");
  const appBlue = getThemeColor("--status-ready", "#45aaf2");

  return {
    background,
    foreground: "#d4d4d4",
    cursor: appBlue,
    cursorAccent: background,
    selectionBackground: "rgba(69, 170, 242, 0.32)",
    selectionInactiveBackground: "rgba(74, 234, 168, 0.22)",
    black: "#1e1e1e",
    red: "#f44747",
    green: appGreen,
    yellow: "#d7ba7d",
    blue: appBlue,
    magenta: "#ffffff",
    cyan: appBlue,
    white: "#d4d4d4",
    brightBlack: "#808080",
    brightRed: "#f44747",
    brightGreen: appGreen,
    brightYellow: "#d7ba7d",
    brightBlue: appBlue,
    brightMagenta: "#ffffff",
    brightCyan: appBlue,
    brightWhite: "#ffffff",
  };
}

export function XTerminal({ terminal: hook, visible, focused }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new Terminal({
      theme: getTheme(),
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(container);

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    requestAnimationFrame(() => {
      fitAddon.fit();
      hook.resize(xterm.cols, xterm.rows);
    });

    const dataDisposable = xterm.onData((data) => {
      hook.write(data);
    });

    const outputUnsub = hook.onOutput((data) => {
      xterm.write(data);
    });

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (fitRef.current && containerRef.current && containerRef.current.offsetHeight > 0) {
          fitRef.current.fit();
          hook.resize(xterm.cols, xterm.rows);
        }
      });
    });
    resizeObserver.observe(container);

    return () => {
      dataDisposable.dispose();
      outputUnsub();
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible && fitRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
      });
    }
  }, [visible]);

  useEffect(() => {
    if (focused && xtermRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
        xtermRef.current?.focus();
      });
    }
  }, [focused]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
