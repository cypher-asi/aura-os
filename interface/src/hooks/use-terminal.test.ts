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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    lastWS = self;
    queueMicrotask(() => {
      self.onopen?.call(self as unknown as WebSocket, new Event("open"));
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

vi.mock("../shared/api/terminal", () => ({
  spawnTerminal: vi.fn().mockResolvedValue({ id: "term-1", shell: "bash" }),
  killTerminal: vi.fn().mockResolvedValue(undefined),
  terminalWsUrl: vi.fn((id: string) => `ws://test/ws/terminal/${id}`),
  remoteTerminalWsUrl: vi.fn((id: string) => `ws://test/ws/agents/${id}/terminal`),
}));

import { spawnTerminal, killTerminal } from "../shared/api/terminal";

describe("useTerminal", () => {
  let origWS: typeof WebSocket;

  beforeEach(() => {
    origWS = globalThis.WebSocket;
    globalThis.WebSocket = MockWS as unknown as typeof WebSocket;
    lastWS = null;
    // Spies retain call history across tests; reset before each so
    // idempotency / call-count assertions see only this test's calls.
    vi.mocked(spawnTerminal).mockClear();
    vi.mocked(killTerminal).mockClear();
    vi.mocked(spawnTerminal).mockResolvedValue({ id: "term-1", shell: "bash" });
    vi.mocked(killTerminal).mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.WebSocket = origWS;
  });

  it("returns null terminalId initially and does not spawn until spawn() is called", async () => {
    const { result } = renderHook(() => useTerminal());
    expect(result.current.terminalId).toBeNull();
    expect(result.current.connected).toBe(false);

    // Give microtasks/promises a chance to run — if the hook were
    // auto-spawning on mount this would have been called by now.
    await act(async () => {
      await Promise.resolve();
    });

    expect(spawnTerminal).not.toHaveBeenCalled();
    expect(lastWS).toBeNull();
  });

  it("spawn(cols, rows) spawns the terminal and connects via WebSocket with the given size", async () => {
    const { result } = renderHook(() => useTerminal({ cwd: "/tmp/proj" }));

    act(() => {
      result.current.spawn(120, 40);
    });

    await vi.waitFor(() => {
      expect(result.current.terminalId).toBe("term-1");
    });

    await vi.waitFor(() => {
      expect(result.current.connected).toBe(true);
    });

    expect(spawnTerminal).toHaveBeenCalledWith({
      cols: 120,
      rows: 40,
      cwd: "/tmp/proj",
      projectId: undefined,
    });
  });

  it("spawn() is idempotent — second call does not spawn another PTY", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    act(() => {
      result.current.spawn(200, 60);
    });
    // Let the second spawn() resolve (it shouldn't, but we wait anyway).
    await act(async () => {
      await Promise.resolve();
    });

    expect(spawnTerminal).toHaveBeenCalledTimes(1);
    expect(spawnTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ cols: 80, rows: 24 }),
    );
  });

  it("write sends JSON input over WebSocket once spawned", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
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

  it("resize sends JSON resize over WebSocket once spawned", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
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

    act(() => {
      result.current.spawn(80, 24);
    });
    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    const received: (string | Uint8Array)[] = [];
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

  it("forwards binary frames as raw bytes without JSON/base64 decoding", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    const received: (string | Uint8Array)[] = [];
    act(() => {
      result.current.onOutput((data) => received.push(data));
    });

    const bytes = new TextEncoder().encode("raw pty output");
    lastWS!.onmessage?.call(
      lastWS as unknown as WebSocket,
      new MessageEvent("message", { data: bytes.buffer }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(received[0] as Uint8Array)).toBe("raw pty output");
  });

  it("kill closes WS and kills terminal", async () => {
    const { result } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
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

    act(() => {
      result.current.spawn(80, 24);
    });
    await vi.waitFor(() => expect(result.current.connected).toBe(true));

    const received: (string | Uint8Array)[] = [];
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
    const { result, unmount } = renderHook(() => useTerminal());

    act(() => {
      result.current.spawn(80, 24);
    });
    await vi.waitFor(() => expect(lastWS).toBeTruthy());
    unmount();

    expect(killTerminal).toHaveBeenCalledWith("term-1");
  });
});
