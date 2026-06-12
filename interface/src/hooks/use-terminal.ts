import { useEffect, useRef, useCallback, useState } from "react";
import {
  spawnTerminal,
  killTerminal,
  terminalWsUrl,
  remoteTerminalWsUrl,
} from "../shared/api/terminal";

export interface UseTerminalOptions {
  /** Fallback if `spawn()` is somehow never called by the consumer.
   *  In normal use the rendering layer measures the container and calls
   *  `spawn(cols, rows)` with the real size, which is the whole point
   *  of the deferred-spawn flow. */
  cols?: number;
  rows?: number;
  cwd?: string;
  /** Optional project context. When set, the server tags the terminal with
   *  this project so passive URL discovery can attribute dev-server URLs
   *  to the right project settings file. */
  projectId?: string;
  /** When set, the terminal connects to the remote agent VM instead of the local shell. */
  remoteAgentId?: string;
}

/** PTY output chunk: local terminals deliver raw bytes (binary WS
 *  frames, handed to xterm.js as `Uint8Array` with zero decode work);
 *  remote terminals and synthesized error banners deliver strings. */
export type TerminalOutputChunk = string | Uint8Array;

export interface UseTerminalReturn {
  terminalId: string | null;
  connected: boolean;
  /** Spawn the underlying PTY at the given size. Idempotent: calling
   *  more than once is a no-op. The hook does NOT spawn on mount —
   *  consumers must measure their container first and then call this
   *  so the shell starts at the correct buffer width. Without this,
   *  PowerShell + ConPTY caches the spawn-time 80x24 size and later
   *  cursor-positioning math (history navigation, multi-line input)
   *  drifts out of sync with what xterm.js actually renders. */
  spawn: (cols: number, rows: number) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onOutput: (cb: (data: TerminalOutputChunk) => void) => () => void;
  kill: () => void;
}

const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";
const REMOTE_TERMINAL_CONNECTION_ERROR =
  "Could not connect to the remote swarm virtual machine terminal.";

function emitError(
  listeners: Set<(data: TerminalOutputChunk) => void>,
  message: string,
  title = "Error:",
) {
  const text = `\r\n${ANSI_RED}${ANSI_BOLD}${title}${ANSI_RESET}${ANSI_RED} ${message}${ANSI_RESET}\r\n`;
  listeners.forEach((cb) => cb(text));
}

function emitRemoteConnectionError(listeners: Set<(data: TerminalOutputChunk) => void>) {
  const text = `\r\n${ANSI_RED}${ANSI_BOLD}ERROR:${ANSI_RESET}${ANSI_RED} ${REMOTE_TERMINAL_CONNECTION_ERROR}${ANSI_RESET}\r\n`;
  listeners.forEach((cb) => cb(text));
}

export function useTerminal(opts: UseTerminalOptions = {}): UseTerminalReturn {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const outputListeners = useRef<Set<(data: TerminalOutputChunk) => void>>(new Set());
  const idRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const spawnedRef = useRef(false);
  // Latest opts captured in a ref so the deferred `spawn()` callback
  // doesn't close over a stale snapshot from the first render.
  // Updated in an effect rather than during render to satisfy the
  // react-hooks/refs lint rule.
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });

  // Mount effect is cleanup-only; the actual PTY spawn is driven by an
  // explicit `spawn(cols, rows)` call from the consumer once it knows
  // the real terminal size.
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      wsRef.current?.close();
      wsRef.current = null;
      if (idRef.current) {
        killTerminal(idRef.current).catch(() => {});
        idRef.current = null;
      }
    };
  }, []);

  const wireWs = useCallback((socket: WebSocket, isRemote: boolean) => {
    wsRef.current = socket;
    socket.binaryType = "arraybuffer";
    let receivedData = false;

    socket.onmessage = (event) => {
      receivedData = true;
      // Local PTY output arrives as raw binary frames — forward the
      // bytes untouched (xterm.js consumes Uint8Array natively). This
      // keeps the per-chunk main-thread cost near zero; the previous
      // JSON + base64 envelope cost a JSON.parse + atob per 4 KiB chunk.
      // (`typeof !== "string"` rather than `instanceof ArrayBuffer` so
      // cross-realm buffers are handled too; `binaryType` is set to
      // "arraybuffer" above, so non-string data is always a buffer.)
      if (typeof event.data !== "string") {
        const bytes = new Uint8Array(event.data as ArrayBuffer);
        outputListeners.current.forEach((cb) => cb(bytes));
        return;
      }
      // Text frames: control messages (`exit`) and the remote-terminal
      // gateway protocol, which still wraps output in JSON + base64.
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output" && msg.data) {
          const decoded = atob(msg.data);
          outputListeners.current.forEach((cb) => cb(decoded));
        }
      } catch {
        // ignore parse errors
      }
    };

    socket.onclose = () => {
      if (cancelledRef.current) return;
      setConnected(false);
      if (!receivedData && isRemote) {
        emitRemoteConnectionError(outputListeners.current);
      }
    };

    socket.onerror = () => {
      socket.close();
    };
  }, []);

  const spawn = useCallback(
    (cols: number, rows: number) => {
      if (spawnedRef.current || cancelledRef.current) return;
      spawnedRef.current = true;

      const currentOpts = optsRef.current;
      const remote = currentOpts.remoteAgentId;

      const initLocal = async () => {
        const resp = await spawnTerminal({
          cols,
          rows,
          cwd: currentOpts.cwd,
          projectId: currentOpts.projectId,
        });

        if (cancelledRef.current) {
          killTerminal(resp.id).catch(() => {});
          return;
        }

        idRef.current = resp.id;
        setTerminalId(resp.id);

        const socket = new WebSocket(await terminalWsUrl(resp.id));
        wireWs(socket, false);

        socket.onopen = () => {
          if (!cancelledRef.current) setConnected(true);
        };
      };

      const initRemote = async (agentId: string) => {
        const socket = new WebSocket(await remoteTerminalWsUrl(agentId));
        wireWs(socket, true);

        socket.onopen = () => {
          if (cancelledRef.current) {
            socket.close();
            return;
          }
          const spawnPayload: Record<string, unknown> = {
            type: "spawn",
            cols,
            rows,
          };
          if (currentOpts.cwd) {
            spawnPayload.cwd = currentOpts.cwd;
          }
          socket.send(JSON.stringify(spawnPayload));
          setConnected(true);
        };
      };

      const run = async () => {
        try {
          if (remote) {
            await initRemote(remote);
          } else {
            await initLocal();
          }
        } catch (err) {
          if (cancelledRef.current) return;
          // Allow a retry from the consumer if the failure was transient.
          spawnedRef.current = false;
          if (remote) {
            emitRemoteConnectionError(outputListeners.current);
          } else {
            const detail = err instanceof Error ? err.message : "unknown error";
            emitError(
              outputListeners.current,
              `Could not spawn local terminal.\r\n${ANSI_YELLOW}       ${detail}${ANSI_RESET}`,
            );
          }
        }
      };

      void run();
    },
    [wireWs],
  );

  const write = useCallback((data: string) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: btoa(data) }));
    }
  }, []);

  const resize = useCallback((cols: number, rows: number) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const onOutput = useCallback((cb: (data: TerminalOutputChunk) => void) => {
    outputListeners.current.add(cb);
    return () => {
      outputListeners.current.delete(cb);
    };
  }, []);

  const kill = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    if (idRef.current) {
      killTerminal(idRef.current).catch(() => {});
      idRef.current = null;
    }
    spawnedRef.current = false;
    setTerminalId(null);
    setConnected(false);
  }, []);

  return { terminalId, connected, spawn, write, resize, onOutput, kill };
}
