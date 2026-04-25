export interface ReconnectConfig {
  url: string;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
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

  function connect() {
    if (stopped) return;
    try {
      ws = new WebSocket(config.url);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      delay = config.initialDelay;
      onStatusChange(true);
    };

    ws.onmessage = (event) => {
      onMessage(event.data);
    };

    ws.onclose = () => {
      onStatusChange(false);
      scheduleReconnect();
    };

    ws.onerror = () => {
      onStatusChange(false);
      ws?.close();
    };
  }

  function scheduleReconnect() {
    if (stopped) return;
    reconnectTimer = setTimeout(() => {
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
      connect();
    }, delay);
  }

  connect();

  return {
    close() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
