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
}

function getThemeBg(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--color-bg").trim() || "#111";
}

const THEME = {
  background: getThemeBg(),
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  cursorAccent: getThemeBg(),
  selectionBackground: "rgba(255, 255, 255, 0.15)",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#6a9955",
  yellow: "#d7ba7d",
  blue: "#569cd6",
  magenta: "#ffffff",
  cyan: "#4ec9b0",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#6a9955",
  brightYellow: "#d7ba7d",
  brightBlue: "#569cd6",
  brightMagenta: "#ffffff",
  brightCyan: "#4ec9b0",
  brightWhite: "#ffffff",
};

export function XTerminal({ terminal: hook, visible }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new Terminal({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      fontSize: 13,
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

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{ display: visible ? "block" : "none" }}
    />
  );
}
