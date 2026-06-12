import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal, type ITerminalAddon } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import "@xterm/xterm/css/xterm.css";
import type { TerminalOutputChunk, UseTerminalReturn } from "../../hooks/use-terminal";
import { OverlayScrollbar } from "../OverlayScrollbar";
import { getXtermTheme, type ResolvedTheme } from "./getXtermTheme";
import { createTerminalLineHistory, type TerminalLineHistory } from "./terminalLineHistory";
import styles from "./XTerminal.module.css";

function readResolvedTheme(): ResolvedTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

interface XTerminalProps {
  terminal: UseTerminalReturn;
  visible: boolean;
  focused: boolean;
  /** Stable key (project id, remote agent id, or "local") used to group the
   *  shared command history that Arrow Up/Down navigates. */
  historyKey: string;
}

// Large scrollback so users can page back through long-running output
// (build logs, agent runs, etc.) inside Sidekick. xterm only allocates
// per actually-written cell, so the worst-case memory cost (~100k rows ×
// ~200 cols) is rarely realized in practice.
const SCROLLBACK_LINES = 100_000;

// Output chunks are queued and flushed in ONE batch per animation
// frame instead of calling `xterm.write` per WebSocket frame, so a
// flood of PTY output costs at most one parse/render pass per display
// frame and leaves the rest of the frame budget to the chat surface.
// If the queue piles up past this cap (rAF doesn't fire while the
// window is backgrounded), flush synchronously so memory stays bounded
// and the buffer is current when the window comes back.
const MAX_PENDING_WRITE_CHUNKS = 64;

export function XTerminal({ terminal: hook, visible, focused, historyKey }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const hookRef = useRef(hook);
  const historyKeyRef = useRef(historyKey);
  const lineHistoryRef = useRef<TerminalLineHistory | null>(null);
  const fitFrameRef = useRef<number | null>(null);
  const pendingFitRef = useRef({ force: false, notifyResize: false });
  // The first fit tells the hook what size to spawn the PTY at.
  // Subsequent fits send a resize over the existing connection.
  // Without this, the PTY would be spawned at the hard-coded 80x24
  // and PowerShell + ConPTY would cache the wrong buffer width,
  // leaving PSReadLine and prompt redraws permanently out of sync
  // with what xterm.js actually renders.
  const hasSpawnedRef = useRef(false);
  const [viewportReady, setViewportReady] = useState(false);

  useEffect(() => {
    hookRef.current = hook;
  }, [hook]);

  useEffect(() => {
    historyKeyRef.current = historyKey;
  }, [historyKey]);

  const scheduleFit = useCallback((options: { force?: boolean; notifyResize?: boolean } = {}) => {
    pendingFitRef.current = {
      force: pendingFitRef.current.force || Boolean(options.force),
      notifyResize: pendingFitRef.current.notifyResize || Boolean(options.notifyResize),
    };

    if (fitFrameRef.current !== null) return;

    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;

      const pending = pendingFitRef.current;
      pendingFitRef.current = { force: false, notifyResize: false };

      const container = containerRef.current;
      const xterm = xtermRef.current;
      const fitAddon = fitRef.current;
      if (!container || !xterm || !fitAddon) return;
      if (!pending.force && container.offsetHeight <= 0) return;

      const proposed = pending.force ? undefined : fitAddon.proposeDimensions();
      if (
        !pending.force
        && (!proposed || (proposed.cols === xterm.cols && proposed.rows === xterm.rows))
      ) {
        return;
      }

      fitAddon.fit();

      if (!hasSpawnedRef.current) {
        hasSpawnedRef.current = true;
        hookRef.current.spawn(xterm.cols, xterm.rows);
      } else if (pending.notifyResize) {
        hookRef.current.resize(xterm.cols, xterm.rows);
      }
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const xterm = new Terminal({
      theme: getXtermTheme(readResolvedTheme()),
      fontFamily: "'Cascadia Code', 'Fira Code', 'JetBrains Mono', Menlo, monospace",
      fontSize: 11,
      lineHeight: 1.3,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: SCROLLBACK_LINES,
    });

    const fitAddon = new FitAddon();
    // Explicit activate handler: the addon's default handler calls
    // window.open() with NO url and assigns popup.location.href afterwards.
    // The wry desktop shell intercepts the new-window request at the first
    // step — while the URL is still about:blank — and asks the OS to open
    // "about:blank", which on Windows pops the "Get an app to open this
    // 'about' link" dialog. Passing the URI directly to window.open makes
    // the shell receive the real link and hand it to the default browser.
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      window.open(uri, "_blank", "noopener,noreferrer");
    });

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

    scheduleFit({ force: true, notifyResize: true });

    lineHistoryRef.current = createTerminalLineHistory({
      getHistoryKey: () => historyKeyRef.current,
      write: (data) => hookRef.current.write(data),
    });

    // Ctrl+L safety net. We let the keystroke through to the shell so the
    // prompt repaints, but also call `xterm.clear()` directly so the
    // 100k-line scrollback is wiped instantly regardless of what the
    // shell emits. This protects against shells whose `clear`/`cls`
    // doesn't include `ESC[3J` (notably cmd.exe's `cls` and remote
    // shells where the server-side override doesn't apply).
    xterm.attachCustomKeyEventHandler((event) => {
      if (
        event.type === "keydown"
        && event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey
        && event.key.toLowerCase() === "l"
      ) {
        xterm.clear();
        return true;
      }
      // Intercept history navigation so it walks the shared per-project
      // history instead of the per-PTY shell history. Returning false stops
      // xterm from forwarding the arrow escape sequence to the shell.
      if (
        event.type === "keydown"
        && !event.ctrlKey
        && !event.shiftKey
        && !event.altKey
        && !event.metaKey
        && (event.key === "ArrowUp" || event.key === "ArrowDown")
      ) {
        lineHistoryRef.current?.handleArrow(event.key === "ArrowUp" ? "up" : "down");
        return false;
      }
      return true;
    });

    const dataDisposable = xterm.onData((data) => {
      lineHistoryRef.current?.onData(data);
      hook.write(data);
    });

    let writeQueue: TerminalOutputChunk[] = [];
    let writeFrame: number | null = null;
    const flushWrites = () => {
      writeFrame = null;
      if (writeQueue.length === 0) return;
      const chunks = writeQueue;
      writeQueue = [];
      for (const chunk of chunks) {
        xterm.write(chunk);
      }
    };
    const outputUnsub = hook.onOutput((data) => {
      writeQueue.push(data);
      if (writeQueue.length >= MAX_PENDING_WRITE_CHUNKS) {
        if (writeFrame !== null) {
          cancelAnimationFrame(writeFrame);
        }
        flushWrites();
        return;
      }
      if (writeFrame === null) {
        writeFrame = requestAnimationFrame(flushWrites);
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      scheduleFit({ notifyResize: true });
    });
    resizeObserver.observe(container);

    return () => {
      dataDisposable.dispose();
      outputUnsub();
      if (writeFrame !== null) {
        cancelAnimationFrame(writeFrame);
        writeFrame = null;
      }
      resizeObserver.disconnect();
      if (fitFrameRef.current !== null) {
        cancelAnimationFrame(fitFrameRef.current);
        fitFrameRef.current = null;
      }
      rendererAddon?.dispose();
      rendererAddon = null;
      xterm.dispose();
      viewportRef.current = null;
      xtermRef.current = null;
      fitRef.current = null;
      lineHistoryRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleFit]);

  // Live theme swap: xterm.js v6 supports re-assigning `terminal.options.theme`
  // and re-renders without remounting, so existing scrollback survives a
  // dark<->light flip. We observe `<html data-theme>` directly rather than
  // keying off ZUI's `useTheme().resolvedTheme` because React effects fire
  // bottom-up: this component's effect would otherwise run BEFORE the parent
  // ThemeProvider effect that flips the attribute, causing
  // getComputedStyle(...) inside getXtermTheme to read the previous palette
  // and the terminal background to lag the rest of the chrome by one toggle.
  useEffect(() => {
    const xterm = xtermRef.current;
    if (!xterm) return;
    const root = document.documentElement;
    const apply = () => {
      xterm.options.theme = getXtermTheme(readResolvedTheme());
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (visible && fitRef.current) {
      scheduleFit({ force: true });
    }
  }, [scheduleFit, visible]);

  useEffect(() => {
    if (focused && fitRef.current) {
      scheduleFit({ force: true });
    }
  }, [focused, scheduleFit]);

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
