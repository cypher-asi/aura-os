import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawnTerminal, listTerminals, killTerminal, terminalWsUrl } from "./terminal";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status < 300 ? "OK" : "Internal Server Error",
    json: () => Promise.resolve(body),
  }) as unknown as typeof globalThis.fetch;
}

describe("spawnTerminal", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("sends POST with cols, rows, and cwd", async () => {
    const response = { id: "term-1", shell: "bash" };
    const fetchMock = mockFetch(200, response);
    globalThis.fetch = fetchMock;

    const result = await spawnTerminal({ cols: 80, rows: 24, cwd: "/home" });
    expect(result).toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24, cwd: "/home" }),
      }),
    );
  });

  it("sends POST without cwd when not provided", async () => {
    const fetchMock = mockFetch(200, { id: "term-1", shell: "zsh" });
    globalThis.fetch = fetchMock;

    await spawnTerminal({ cols: 120, rows: 40 });
    const body = JSON.parse((fetchMock as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({ cols: 120, rows: 40 });
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = mockFetch(500, null);
    await expect(spawnTerminal({ cols: 80, rows: 24 })).rejects.toThrow("Spawn terminal failed");
  });
});

describe("listTerminals", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("fetches GET /api/terminal with credentials", async () => {
    const terminals = [{ id: "t1", shell: "bash", cols: 80, rows: 24, cwd: "/", created_at: 0 }];
    const fetchMock = mockFetch(200, terminals);
    globalThis.fetch = fetchMock;

    const result = await listTerminals();
    expect(result).toEqual(terminals);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = mockFetch(500, null);
    await expect(listTerminals()).rejects.toThrow("List terminals failed");
  });
});

describe("killTerminal", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("sends DELETE /api/terminal/:id", async () => {
    const fetchMock = mockFetch(204, null);
    globalThis.fetch = fetchMock;

    await killTerminal("term-1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/terminal/term-1",
      expect.objectContaining({ method: "DELETE", credentials: "include" }),
    );
  });

  it("does not throw on 204", async () => {
    globalThis.fetch = mockFetch(204, null);
    await expect(killTerminal("term-1")).resolves.toBeUndefined();
  });

  it("throws on non-204 error", async () => {
    globalThis.fetch = mockFetch(500, null);
    await expect(killTerminal("term-1")).rejects.toThrow("Kill terminal failed");
  });
});

describe("terminalWsUrl", () => {
  it("returns ws URL with terminal id", () => {
    const url = terminalWsUrl("term-1");
    expect(url).toContain("/ws/terminal/term-1");
    expect(url).toMatch(/^wss?:\/\//);
  });
});
