import { useEffect, useRef, useCallback, useState } from "react";
import { spawnTerminal, killTerminal, terminalWsUrl } from "../api/terminal";

export interface UseTerminalOptions {
  cols?: number;
  rows?: number;
  cwd?: string;
}

export interface UseTerminalReturn {
  terminalId: string | null;
  connected: boolean;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  onOutput: (cb: (data: string) => void) => () => void;
  kill: () => void;
}

export function useTerminal(opts: UseTerminalOptions = {}): UseTerminalReturn {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const outputListeners = useRef<Set<(data: string) => void>>(new Set());
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let ws: WebSocket | null = null;

    async function init() {
      try {
        const resp = await spawnTerminal({
          cols: opts.cols ?? 80,
          rows: opts.rows ?? 24,
          cwd: opts.cwd,
        });

        if (cancelled) {
          killTerminal(resp.id).catch(() => {});
          return;
        }

        idRef.current = resp.id;
        setTerminalId(resp.id);

        ws = new WebSocket(terminalWsUrl(resp.id));
        wsRef.current = ws;

        ws.onopen = () => {
          if (!cancelled) setConnected(true);
        };

        ws.onmessage = (event) => {
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

        ws.onclose = () => {
          if (!cancelled) setConnected(false);
        };

        ws.onerror = () => {
          ws?.close();
        };
      } catch {
        // spawn failed
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
