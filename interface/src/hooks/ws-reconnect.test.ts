import { createReconnectingWebSocket } from "./ws-reconnect";

type WSHandler = ((this: WebSocket, ev: Event) => void) | null;
type WSMessageHandler = ((this: WebSocket, ev: MessageEvent) => void) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: WSHandler = null;
  onclose: WSHandler = null;
  onerror: WSHandler = null;
  onmessage: WSMessageHandler = null;
  closeCalled = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    this.closeCalled = true;
    this.onclose?.call(this as unknown as WebSocket, new Event("close"));
  }

  simulateOpen(): void {
    this.onopen?.call(this as unknown as WebSocket, new Event("open"));
  }

  simulateMessage(data: string): void {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent("message", { data }),
    );
  }

  simulateError(): void {
    this.onerror?.call(this as unknown as WebSocket, new Event("error"));
  }
}

describe("createReconnectingWebSocket", () => {
  let origWS: typeof WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    origWS = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = origWS;
  });

  it("connects immediately", () => {
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      vi.fn(),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toBe("ws://test");
  });

  it("calls onStatusChange(true) on open", () => {
    const onStatus = vi.fn();
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      onStatus,
    );

    MockWebSocket.instances[0].simulateOpen();
    expect(onStatus).toHaveBeenCalledWith(true);
  });

  it("calls onMessage with data", () => {
    const onMessage = vi.fn();
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      onMessage,
      vi.fn(),
    );

    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].simulateMessage("hello");

    expect(onMessage).toHaveBeenCalledWith("hello");
  });

  it("reconnects after close with backoff", () => {
    const onStatus = vi.fn();
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      onStatus,
    );

    MockWebSocket.instances[0].simulateOpen();
    MockWebSocket.instances[0].close();

    expect(onStatus).toHaveBeenCalledWith(false);
    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("applies exponential backoff up to maxDelay", () => {
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 400, backoffMultiplier: 2 },
      vi.fn(),
      vi.fn(),
    );

    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(100);
    expect(MockWebSocket.instances).toHaveLength(2);

    MockWebSocket.instances[1].close();
    vi.advanceTimersByTime(200);
    expect(MockWebSocket.instances).toHaveLength(3);

    MockWebSocket.instances[2].close();
    vi.advanceTimersByTime(400);
    expect(MockWebSocket.instances).toHaveLength(4);

    MockWebSocket.instances[3].close();
    vi.advanceTimersByTime(400);
    expect(MockWebSocket.instances).toHaveLength(5);
  });

  it("resets delay after successful connection", () => {
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      vi.fn(),
    );

    MockWebSocket.instances[0].close();
    vi.advanceTimersByTime(100);
    MockWebSocket.instances[1].simulateOpen();
    MockWebSocket.instances[1].close();

    vi.advanceTimersByTime(100);
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("stops reconnecting after close() is called", () => {
    const handle = createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      vi.fn(),
    );

    handle.close();

    vi.advanceTimersByTime(10000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("closes WebSocket on error", () => {
    const onStatus = vi.fn();
    createReconnectingWebSocket(
      { url: "ws://test", initialDelay: 100, maxDelay: 5000, backoffMultiplier: 2 },
      vi.fn(),
      onStatus,
    );

    MockWebSocket.instances[0].simulateError();
    expect(onStatus).toHaveBeenCalledWith(false);
    expect(MockWebSocket.instances[0].closeCalled).toBe(true);
  });
});
