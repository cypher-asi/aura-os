import { resolveApiUrl, resolveWsUrl } from "../lib/host-config";

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
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Spawn terminal failed: ${res.statusText}`);
  return res.json();
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await fetch(resolveApiUrl("/api/terminal"), { credentials: "include" });
  if (!res.ok) throw new Error(`List terminals failed: ${res.statusText}`);
  return res.json();
}

export async function killTerminal(id: string): Promise<void> {
  const res = await fetch(resolveApiUrl(`/api/terminal/${id}`), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 204)
    throw new Error(`Kill terminal failed: ${res.statusText}`);
}

export function terminalWsUrl(id: string): string {
  return resolveWsUrl(`/ws/terminal/${id}`);
}

// ---------------------------------------------------------------------------
// Remote terminal (shell inside the agent VM/pod via swarm gateway)
//
// The entire lifecycle (spawn, I/O, kill) runs over a single WebSocket.
// The client sends a `spawn` message as the first frame; the pod responds
// with `spawned`. Closing the socket kills the terminal.
// ---------------------------------------------------------------------------

export function remoteTerminalWsUrl(agentId: string): string {
  return resolveWsUrl(
    `/ws/agents/${agentId}/remote_agent/terminal`,
  );
}
