import type { RemoteVmState } from "../shared/types";
import { formatClientDevice } from "../shared/lib/device-info";
import { useAvatarState } from "./use-avatar-state";
import { useEnvironmentInfo } from "./use-environment-info";
import { useRemoteAgentState } from "./use-remote-agent-state";

/**
 * Agent + device context attached to every error rendered on the chat
 * page. Surfaced visibly in the error block and folded into the copied
 * error text so a user-shared failure is self-describing (which agent,
 * local or remote, its status, the client device, and the agent's
 * machine).
 */
export interface ErrorReportAgentInfo {
  name: string | null;
  machineType: "local" | "remote";
  status: string | null;
  /** Device the user is currently running the app on. */
  clientDevice: string;
  /** Machine the agent itself runs on (local hostname / remote VM). */
  agentMachine: string;
  /** IP address of the agent's machine (local IP / remote endpoint). */
  ip: string | null;
}

interface UseErrorReportAgentInfoInput {
  agentId?: string;
  agentName?: string;
  machineType?: "local" | "remote";
}

function formatRemoteMachine(
  state: RemoteVmState | null,
  agentId: string | undefined,
): string {
  const name = state?.name?.trim();
  const vmState = state?.state?.trim();
  if (name && vmState) return `Remote VM ${name} (${vmState})`;
  if (name) return `Remote VM ${name}`;
  if (vmState) return `Remote VM (${vmState})`;
  return agentId ? `Remote VM ${agentId}` : "Remote VM";
}

/**
 * Resolve the agent identity + device context used to annotate chat
 * error blocks. Composes the avatar status store, the local env info
 * (single cached fetch), and — only for remote agents — the remote VM
 * state poll. Always returns a fully-populated object with readable
 * fallbacks so the error annotation never renders blanks.
 */
export function useErrorReportAgentInfo({
  agentId,
  agentName,
  machineType,
}: UseErrorReportAgentInfoInput): ErrorReportAgentInfo {
  const resolvedMachineType = machineType ?? "local";
  const isRemote = resolvedMachineType === "remote";

  const { status } = useAvatarState(agentId);
  const { data: envInfo } = useEnvironmentInfo();
  // Remote VM state is polled only for remote agents; `undefined`
  // short-circuits the hook so local chats issue no extra request.
  const { data: remoteState } = useRemoteAgentState(isRemote ? agentId : undefined);

  const ip = isRemote
    ? remoteState?.endpoint?.trim() || null
    : envInfo?.ip?.trim() || null;

  const clientDevice = formatClientDevice({
    hostname: envInfo?.hostname,
    os: envInfo?.os,
    ip: envInfo?.ip,
  });

  const agentMachine = isRemote
    ? formatRemoteMachine(remoteState, agentId)
    : envInfo?.hostname?.trim() || clientDevice;

  return {
    name: agentName?.trim() || null,
    machineType: resolvedMachineType,
    status: status ?? null,
    clientDevice,
    agentMachine,
    ip,
  };
}

/**
 * Render the agent/device context as the copyable block appended to a
 * shared error message. Kept pure (no React) so it can be unit-tested
 * and reused by the diagnostics collector.
 */
export function formatErrorReportAgentInfo(
  info: ErrorReportAgentInfo | undefined,
): string {
  if (!info) return "";
  const name = info.name ?? "unknown";
  const typeLabel = info.machineType === "remote" ? "remote" : "local";
  const status = info.status ?? "unknown";
  return [
    `Agent: ${name} (${typeLabel}, ${status})`,
    `Client device: ${info.clientDevice || "unknown"}`,
    `Agent machine: ${info.agentMachine || "unknown"}`,
    `IP: ${info.ip || "unknown"}`,
  ].join("\n");
}
