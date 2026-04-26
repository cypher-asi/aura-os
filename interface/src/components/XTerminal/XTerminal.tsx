import { useEffect, useRef, useState } from "react";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import type { UseTerminalReturn } from "../../hooks/use-terminal";
import { OverlayScrollbar } from "../OverlayScrollbar";
import styles from "./XTerminal.module.css";

interface XTerminalProps {
  terminal: UseTerminalReturn;
  visible: boolean;
  focused: boolean;
}

// Large scrollback so users can page back through long-running output
// (build logs, agent runs, etc.) inside Sidekick. xterm only allocates
// per actually-written cell, so the worst-case memory cost (~100k rows ×
// ~200 cols) is rarely realized in practice.
const SCROLLBACK_LINES = 100_000;

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
    cursor: appGreen,
    cursorAccent: background,
    selectionBackground: "rgba(74, 234, 168, 0.32)",
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
  const viewportRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [viewportReady, setViewportReady] = useState(false);

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
      scrollback: SCROLLBACK_LINES,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    xterm.loadAddon(fitAddon);
    xterm.loadAddon(webLinksAddon);
    xterm.open(container);
    viewportRef.current = container.querySelector(".xterm-viewport") as HTMLDivElement | null;
    setViewportReady(Boolean(viewportRef.current));

    xtermRef.current = xterm;
    fitRef.current = fitAddon;

    // Prefer the GPU-accelerated renderer so scrolling through a deep
    // scrollback stays smooth. Fall back to the canvas renderer if WebGL
    // fails to initialize or its context is lost (e.g. tab backgrounded).
    let rendererAddon: ITerminalAddon | null = null;
    const loadCanvasFallback = () => {
      try {
        const canvas = new CanvasAddon();
        xterm.loadAddon(canvas);
        rendererAddon = canvas;
      } catch {
        rendererAddon = null;
      }
    };
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        if (rendererAddon === webgl) rendererAddon = null;
        loadCanvasFallback();
      });
      xterm.loadAddon(webgl);
      rendererAddon = webgl;
    } catch {
      loadCanvasFallback();
    }

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
      rendererAddon?.dispose();
      rendererAddon = null;
      xterm.dispose();
      viewportRef.current = null;
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
    if (focused && fitRef.current) {
      requestAnimationFrame(() => {
        fitRef.current?.fit();
      });
    }
  }, [focused]);

  return (
    <div
      className={styles.container}
      style={{ display: visible ? "block" : "none" }}
    >
      <div ref={containerRef} className={styles.surface} />
      {viewportReady && (
        <OverlayScrollbar scrollRef={viewportRef} trackClassName={styles.overlayTrack} />
      )}
    </div>
  );
}
