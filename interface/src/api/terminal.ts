import { authHeaders, getStoredJwt } from "../lib/auth-token";
import { resolveApiUrl, resolveWsUrl } from "../lib/host-config";
import { ApiClientError } from "./core";
import type { ApiError } from "../types";

export interface TerminalInfo {
  id: string;
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  created_at: number;
}

export interface SpawnTerminalResponse {
  id: string;
  shell: string;
}

async function throwApiError(res: Response): Promise<never> {
  const err: ApiError = await res.json().catch(() => ({
    error: res.statusText,
    code: "unknown",
    details: null,
  }));
  throw new ApiClientError(res.status, err);
}

// ---------------------------------------------------------------------------
// Local terminal (PTY on the aura-os-server host)
// ---------------------------------------------------------------------------

export async function spawnTerminal(opts: {
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<SpawnTerminalResponse> {
  const res = await fetch(resolveApiUrl("/api/terminal"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(opts),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await fetch(resolveApiUrl("/api/terminal"), {
    headers: authHeaders(),
  });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function killTerminal(id: string): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/terminal/${id}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok && res.status !== 204 && res.status !== 404)
    await throwApiError(res);
}

function appendWsToken(url: string): string {
  const jwt = getStoredJwt();
  if (!jwt) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(jwt)}`;
}

export function terminalWsUrl(id: string): string {
  return appendWsToken(resolveWsUrl(`/ws/terminal/${id}`));
}

// ---------------------------------------------------------------------------
// Remote terminal (shell inside the agent VM/pod via swarm gateway)
//
// The entire lifecycle (spawn, I/O, kill) runs over a single WebSocket.
// The client sends a `spawn` message as the first frame; the pod responds
// with `spawned`. Closing the socket kills the terminal.
// ---------------------------------------------------------------------------

export function remoteTerminalWsUrl(agentId: string): string {
  return appendWsToken(
    resolveWsUrl(`/ws/agents/${agentId}/remote_agent/terminal`),
  );
}
