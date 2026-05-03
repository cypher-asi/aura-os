import { useEffect, useRef, useState } from "react";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import { useTheme } from "@cypher-asi/zui";
import type { UseTerminalReturn } from "../../hooks/use-terminal";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { getXtermTheme } from "./getXtermTheme";
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

export function XTerminal({ terminal: hook, visible, focused }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [viewportReady, setViewportReady] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new Terminal({
      theme: getXtermTheme(resolvedTheme),
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

  // Live theme swap: xterm.js v6 supports re-assigning `terminal.options.theme`
  // and re-renders without remounting, so existing scrollback survives a
  // dark↔light flip.
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    xterm.options.theme = getXtermTheme(resolvedTheme);
  }, [resolvedTheme]);

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
