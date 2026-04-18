import { useCallback, useEffect, useRef, useState } from "react";
import {
  browserWsUrl,
  decodeBinaryFrame,
  encodeFrameAck,
  isBrowserServerTextEvent,
  killBrowser,
  spawnBrowser,
  type BrowserClientMsg,
  type NavState,
  type SpawnBrowserResponse,
} from "../api/browser";

export interface UseBrowserOptions {
  /** Whether to kick off the spawn automatically on mount. Defaults to true. */
  autoSpawn?: boolean;
  projectId?: string;
  initialUrl?: string;
  width: number;
  height: number;
  onFrame?: (frame: { seq: number; width: number; height: number; jpeg: Uint8Array }) => void;
  onNav?: (nav: NavState) => void;
  onExit?: (code: number) => void;
  onSpawned?: (spawn: SpawnBrowserResponse) => void;
  onError?: (err: Error) => void;
}

export interface UseBrowserReturn {
  sessionId: string | null;
  connected: boolean;
  spawning: boolean;
  initialUrl: string | null;
  focusAddressBar: boolean;
  /** Imperatively spawn (only needed when `autoSpawn` is false). */
  spawn: () => Promise<SpawnBrowserResponse | null>;
  send: (msg: BrowserClientMsg) => void;
  kill: () => Promise<void>;
}

export function useBrowser(opts: UseBrowserOptions): UseBrowserReturn {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [initialUrl, setInitialUrl] = useState<string | null>(null);
  const [focusAddressBar, setFocusAddressBar] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const openSocket = useCallback((id: string) => {
    const ws = new WebSocket(browserWsUrl(id));
    ws.binaryType = "arraybuffer";
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () =>
      optsRef.current.onError?.(new Error("browser WebSocket error"));
    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = decodeBinaryFrame(event.data);
        if (!frame) return;
        optsRef.current.onFrame?.({
          seq: frame.header.seq,
          width: frame.header.width,
          height: frame.header.height,
          jpeg: frame.jpeg,
        });
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(encodeFrameAck(frame.header.seq));
        }
        return;
      }
      if (typeof event.data !== "string") return;
      try {
        const parsed: unknown = JSON.parse(event.data);
        if (!isBrowserServerTextEvent(parsed)) return;
        if (parsed.type === "nav") {
          optsRef.current.onNav?.(parsed.nav);
        } else {
          optsRef.current.onExit?.(parsed.code);
        }
      } catch {
        // Malformed server text — silently drop (boundary parse).
      }
    };
    wsRef.current = ws;
  }, []);

  const spawnSession = useCallback(async (): Promise<SpawnBrowserResponse | null> => {
    if (sessionRef.current) return null;
    setSpawning(true);
    try {
      const result = await spawnBrowser({
        width: optsRef.current.width,
        height: optsRef.current.height,
        projectId: optsRef.current.projectId,
        initialUrl: optsRef.current.initialUrl,
      });
      sessionRef.current = result.id;
      setSessionId(result.id);
      setInitialUrl(result.initial_url);
      setFocusAddressBar(result.focus_address_bar);
      optsRef.current.onSpawned?.(result);
      openSocket(result.id);
      return result;
    } catch (err) {
      optsRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setSpawning(false);
    }
  }, [openSocket]);

  const send = useCallback((msg: BrowserClientMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(msg));
  }, []);

  const kill = useCallback(async () => {
    const id = sessionRef.current;
    if (!id) return;
    sessionRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    wsRef.current = null;
    try {
      await killBrowser(id);
    } catch {
      // Best-effort cleanup; server-side idempotent.
    }
    setSessionId(null);
    setConnected(false);
  }, []);

  const autoSpawn = opts.autoSpawn ?? true;

  useEffect(() => {
    if (!autoSpawn) return;
    let cancelled = false;
    void spawnSession().then(() => {
      if (cancelled) {
        // If the component unmounted while spawn was in flight, tidy up.
        void kill();
      }
    });
    return () => {
      cancelled = true;
      void kill();
    };
    // spawnSession & kill are memoized; only autoSpawn matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSpawn]);

  return {
    sessionId,
    connected,
    spawning,
    initialUrl,
    focusAddressBar,
    spawn: spawnSession,
    send,
    kill,
  };
}
