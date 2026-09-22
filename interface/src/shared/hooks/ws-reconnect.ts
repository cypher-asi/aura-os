export interface ReconnectConfig {
  /**
   * The WebSocket URL. May be a function so callers can recompute it on
   * every (re)connect attempt — e.g. to append a `?since=<seq>` cursor
   * that reflects the newest event processed before the disconnect, or
   * to mint a fresh short-lived `?ticket=` (see `mintWsTicket`) so the
   * long-lived JWT never appears in the URL. The function may be async
   * for that reason.
   */
  url: string | (() => string | Promise<string>);
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  /**
   * Replace the current socket as soon as the document returns to the
   * foreground. Mobile operating systems may freeze a WebView while leaving
   * its WebSocket in an apparently-open state; reconnecting lets callers mint
   * fresh credentials and replay from their last durable cursor immediately.
   */
  resumeOnForeground?: boolean;
}

export function createReconnectingWebSocket(
  config: ReconnectConfig,
  onMessage: (data: string) => void,
  onStatusChange: (connected: boolean) => void,
): { close: () => void } {
  let ws: WebSocket | null = null;
  let delay = config.initialDelay;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connectAttempt = 0;

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function detachAndCloseSocket() {
    const socket = ws;
    ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.close();
  }

  function openSocket(url: string, attempt: number) {
    // The URL may have been resolved asynchronously (e.g. while minting
    // a connect ticket); bail if the consumer closed or superseded this
    // attempt in the meantime.
    if (stopped || attempt !== connectAttempt) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
      ws = socket;
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = () => {
      if (socket !== ws || attempt !== connectAttempt) return;
      delay = config.initialDelay;
      onStatusChange(true);
    };

    socket.onmessage = (event) => {
      if (socket !== ws || attempt !== connectAttempt) return;
      onMessage(event.data);
    };

    socket.onclose = () => {
      if (socket !== ws || attempt !== connectAttempt) return;
      ws = null;
      onStatusChange(false);
      scheduleReconnect();
    };

    socket.onerror = () => {
      if (socket !== ws || attempt !== connectAttempt) return;
      onStatusChange(false);
      socket.close();
    };
  }

  function connect() {
    if (stopped) return;
    const attempt = ++connectAttempt;
    let resolved: string | Promise<string>;
    try {
      resolved = typeof config.url === "function" ? config.url() : config.url;
    } catch {
      scheduleReconnect();
      return;
    }
    // Keep the synchronous path synchronous (string / sync-function
    // URLs open the socket immediately); only defer when the builder is
    // genuinely async (ticket minting).
    if (typeof resolved === "string") {
      openSocket(resolved, attempt);
    } else {
      resolved
        .then((url) => openSocket(url, attempt))
        .catch(() => {
          if (attempt === connectAttempt) scheduleReconnect();
        });
    }
  }

  function scheduleReconnect() {
    if (stopped) return;
    clearReconnectTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
      connect();
    }, delay);
  }

  function reconnectNow() {
    if (stopped) return;
    // Invalidate an async URL/ticket resolution that may still be pending,
    // remove any backed-off retry, and replace even an apparently-open socket.
    connectAttempt += 1;
    clearReconnectTimer();
    detachAndCloseSocket();
    delay = config.initialDelay;
    onStatusChange(false);
    connect();
  }

  const handleVisibilityChange = () => {
    if (document.visibilityState === "visible") reconnectNow();
  };
  if (config.resumeOnForeground && typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
  }

  connect();

  return {
    close() {
      stopped = true;
      connectAttempt += 1;
      clearReconnectTimer();
      if (config.resumeOnForeground && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
      detachAndCloseSocket();
    },
  };
}
