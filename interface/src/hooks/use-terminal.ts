import { useEffect, useRef, useCallback, useState } from "react";
import {
  spawnTerminal,
  killTerminal,
  terminalWsUrl,
  remoteTerminalWsUrl,
} from "../api/terminal";

export interface UseTerminalOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
  /** When set, the terminal connects to the remote agent VM instead of the local shell. */
  remoteAgentId?: string;
}

export interface UseTerminalReturn {
  terminalId: string | null;
  connected: boolean;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onOutput: (cb: (data: string) => void) => () => void;
  kill: () => void;
}

const ANSI_RED = "\x1b[31m";
const ANSI_YELLOW = "\x1b[33m";
const ANSI_RESET = "\x1b[0m";
const ANSI_BOLD = "\x1b[1m";

function emitError(
  listeners: Set<(data: string) => void>,
  message: string,
) {
  const text = `\r\n${ANSI_RED}${ANSI_BOLD}Error:${ANSI_RESET}${ANSI_RED} ${message}${ANSI_RESET}\r\n`;
  listeners.forEach((cb) => cb(text));
}

export function useTerminal(opts: UseTerminalOptions = {}): UseTerminalReturn {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const outputListeners = useRef<Set<(data: string) => void>>(new Set());
  const idRef = useRef<string | null>(null);
  const remoteRef = useRef<string | undefined>(opts.remoteAgentId);
  remoteRef.current = opts.remoteAgentId;

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    function wireWs(socket: WebSocket, isRemote: boolean) {
      ws = socket;
      wsRef.current = socket;
      let receivedData = false;

      socket.onmessage = (event) => {
        receivedData = true;
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
        if (cancelled) return;
        setConnected(false);
        if (!receivedData && isRemote) {
          emitError(
            outputListeners.current,
            `Could not connect to the remote agent VM terminal.\r\n\r\n${ANSI_YELLOW}       Make sure the agent is running and the swarm gateway is reachable.${ANSI_RESET}`,
          );
        }
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    async function initLocal() {
      const cols = opts.cols ?? 80;
      const rows = opts.rows ?? 24;

      const resp = await spawnTerminal({ cols, rows, cwd: opts.cwd });

      if (cancelled) {
        killTerminal(resp.id).catch(() => {});
        return;
      }

      idRef.current = resp.id;
      setTerminalId(resp.id);

      const socket = new WebSocket(terminalWsUrl(resp.id));
      wireWs(socket, false);

      socket.onopen = () => {
        if (!cancelled) setConnected(true);
      };
    }

    function initRemote(agentId: string) {
      const cols = opts.cols ?? 80;
      const rows = opts.rows ?? 24;

      const socket = new WebSocket(remoteTerminalWsUrl(agentId));
      wireWs(socket, true);

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        const spawnPayload: Record<string, unknown> = { type: "spawn", cols, rows };
        if (opts.cwd) {
          spawnPayload.cwd = opts.cwd;
        }
        socket.send(
          JSON.stringify(spawnPayload),
        );
        setConnected(true);
      };
    }

    async function init() {
      const remote = opts.remoteAgentId;
      try {
        if (remote) {
          initRemote(remote);
        } else {
          await initLocal();
        }
      } catch (err) {
        if (cancelled) return;
        const detail =
          err instanceof Error ? err.message : "unknown error";
        if (remote) {
          emitError(
            outputListeners.current,
            `Could not connect to the remote agent VM terminal.\r\n${ANSI_YELLOW}       ${detail}${ANSI_RESET}\r\n\r\n       Make sure the agent is running and the swarm gateway is reachable.`,
          );
        } else {
          emitError(
            outputListeners.current,
            `Could not spawn local terminal.\r\n${ANSI_YELLOW}       ${detail}${ANSI_RESET}`,
          );
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      ws?.close();
      wsRef.current = null;
      if (idRef.current) {
        killTerminal(idRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const onOutput = useCallback((cb: (data: string) => void) => {
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
    setTerminalId(null);
    setConnected(false);
  }, []);

  return { terminalId, connected, write, resize, onOutput, kill };
}
