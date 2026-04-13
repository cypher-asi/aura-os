import { renderHook, act } from "@testing-library/react";
import { useTerminal } from "./use-terminal";

type WSHandler = ((this: WebSocket, ev: Event) => void) | null;
type WSMessageHandler = ((this: WebSocket, ev: MessageEvent) => void) | null;

let lastWS: MockWS | null = null;

class MockWS {
  url: string;
  readyState = 1;
  onopen: WSHandler = null;
  onclose: WSHandler = null;
  onerror: WSHandler = null;
  onmessage: WSMessageHandler = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    lastWS = this;
    queueMicrotask(() => {
      this.onopen?.call(this as unknown as WebSocket, new Event("open"));
    });
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.call(this as unknown as WebSocket, new Event("close"));
  }

  static readonly OPEN = 1;
  static readonly CLOSED = 3;
}

vi.mock("../api/terminal", () => ({
  spawnTerminal: vi.fn().mockResolvedValue({ id: "term-1", shell: "bash" }),
  killTerminal: vi.fn().mockResolvedValue(undefined),
  terminalWsUrl: vi.fn((id: string) => `ws://test/ws/terminal/${id}`),
  remoteTerminalWsUrl: vi.fn((id: string) => `ws://test/ws/agents/${id}/terminal`),
}));

import { spawnTerminal, killTerminal } from "../api/terminal";

describe("useTerminal", () => {
  let origWS: typeof WebSocket;

  beforeEach(() => {
    origWS = globalThis.WebSocket;
    globalThis.WebSocket = MockWS as unknown as typeof WebSocket;
    lastWS = null;
    vi.mocked(spawnTerminal).mockResolvedValue({ id: "term-1", shell: "bash" });
    vi.mocked(killTerminal).mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.WebSocket = origWS;
  });

  it("returns null terminalId initially", () => {
    const { result } = renderHook(() => useTerminal());
    expect(result.current.terminalId).toBeNull();
    expect(result.current.connected).toBe(false);
  });

  it("spawns a terminal and connects via WebSocket", async () => {
    const { result } = renderHook(() => useTerminal({ cols: 120, rows: 40 }));

    await vi.waitFor(() => {
      expect(result.current.terminalId).toBe("term-1");
    });

    await vi.waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    expect(spawnTerminal).toHaveBeenCalledWith({
      cols: 120,
      rows: 40,
      cwd: undefined,
    });
  });

  it("write sends JSON input over WebSocket", async () => {
    const { result } = renderHook(() => useTerminal());

    await vi.waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    act(() => {
      result.current.write("ls\n");
    });

    expect(lastWS!.sent.length).toBe(1);
    const msg = JSON.parse(lastWS!.sent[0]);
    expect(msg.type).toBe("input");
    expect(atob(msg.data)).toBe("ls\n");
  });

  it("resize sends JSON resize over WebSocket", async () => {
    const { result } = renderHook(() => useTerminal());

    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      result.current.resize(200, 50);
    });

    const msg = JSON.parse(lastWS!.sent[0]);
    expect(msg.type).toBe("resize");
    expect(msg.cols).toBe(200);
    expect(msg.rows).toBe(50);
  });

  it("onOutput registers listeners that receive decoded data", async () => {
    const { result } = renderHook(() => useTerminal());

    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    const received: string[] = [];
    act(() => {
      result.current.onOutput((data) => received.push(data));
    });

    const encoded = btoa("hello world");
    lastWS!.onmessage?.call(
      lastWS as unknown as WebSocket,
      new MessageEvent("message", {
        data: JSON.stringify({ type: "output", data: encoded }),
      }),
    );

    expect(received).toEqual(["hello world"]);
  });

  it("kill closes WS and kills terminal", async () => {
    const { result } = renderHook(() => useTerminal());

    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      result.current.kill();
    });

    expect(result.current.terminalId).toBeNull();
    expect(result.current.connected).toBe(false);
    expect(killTerminal).toHaveBeenCalledWith("term-1");
  });

  it("emits the remote terminal connection error without indented follow-up text", async () => {
    const { result } = renderHook(() => useTerminal({ remoteAgentId: "agent-1" }));

    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    const received: string[] = [];
    act(() => {
      result.current.onOutput((data) => received.push(data));
    });

    act(() => {
      lastWS!.close();
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toContain("ERROR:");
    expect(received[0]).toContain(
      "Could not connect to the remote swarm virtual machine terminal.",
    );
    expect(received[0]).not.toContain("Make sure the agent is running");
    expect(received[0]).not.toContain("       ");
  });

  it("cleans up on unmount", async () => {
    const { unmount } = renderHook(() => useTerminal());

    await vi.waitFor(() => expect(lastWS).toBeTruthy());
    unmount();

    expect(killTerminal).toHaveBeenCalledWith("term-1");
  });
});
