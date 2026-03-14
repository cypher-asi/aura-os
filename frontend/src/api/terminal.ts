const BASE_URL = "";

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

export async function spawnTerminal(opts: {
  cols: number;
  rows: number;
  cwd?: string;
}): Promise<SpawnTerminalResponse> {
  const res = await fetch(`${BASE_URL}/api/terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`Spawn terminal failed: ${res.statusText}`);
  return res.json();
}

export async function listTerminals(): Promise<TerminalInfo[]> {
  const res = await fetch(`${BASE_URL}/api/terminal`);
  if (!res.ok) throw new Error(`List terminals failed: ${res.statusText}`);
  return res.json();
}

export async function killTerminal(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/terminal/${id}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 204)
    throw new Error(`Kill terminal failed: ${res.statusText}`);
}

export function terminalWsUrl(id: string): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal/${id}`;
}
