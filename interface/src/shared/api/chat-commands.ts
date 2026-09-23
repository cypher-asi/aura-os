import { apiFetch } from "./core";

export type ChatCommandExecutionStatus =
  | "attached"
  | "completed"
  | "failed"
  | "unconfirmed";

export type ChatCommandStatusTarget =
  | { surface: "agent"; agentId: string; sessionId: string }
  | { surface: "project"; projectId: string; agentInstanceId: string; sessionId: string };

export interface ChatCommandStatus {
  commandId: string;
  sessionId: string;
  executionStatus: ChatCommandExecutionStatus;
}

/** Read-only run lookup. This endpoint cannot persist or execute a prompt. */
export async function getChatCommandStatus(
  target: ChatCommandStatusTarget,
  commandId: string,
): Promise<ChatCommandStatus> {
  const session = encodeURIComponent(target.sessionId);
  const command = encodeURIComponent(commandId);
  const path = target.surface === "agent"
    ? `/api/agents/${encodeURIComponent(target.agentId)}/sessions/${session}/commands/${command}/status`
    : `/api/projects/${encodeURIComponent(target.projectId)}/agents/${encodeURIComponent(target.agentInstanceId)}/sessions/${session}/commands/${command}/status`;
  const raw = await apiFetch<unknown>(path, { timeoutMs: 12_000 });
  if (!raw || typeof raw !== "object") {
    throw new Error("Aura returned an invalid agent-command status");
  }
  const result = raw as Record<string, unknown>;
  if (result.commandId !== commandId || result.sessionId !== target.sessionId ||
    (result.executionStatus !== "attached" && result.executionStatus !== "completed" &&
      result.executionStatus !== "failed" && result.executionStatus !== "unconfirmed")) {
    throw new Error("Aura returned an unrelated agent-command status");
  }
  return result as unknown as ChatCommandStatus;
}
