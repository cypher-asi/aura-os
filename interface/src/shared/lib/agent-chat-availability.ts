export interface AgentChatAvailability {
  available: boolean;
  label: string;
  reason?: string;
}

const AVAILABLE: AgentChatAvailability = {
  available: true,
  label: "Online",
};

/**
 * Resolve whether an agent can accept a new chat turn. Local agents are
 * available whenever their surface is available; remote agents must have a
 * confirmed running VM so a stopped or unreachable runtime cannot leave the
 * composer waiting on a stream that will never begin.
 */
export function resolveAgentChatAvailability(
  machineType: string | undefined,
  remoteStatus: string | undefined,
): AgentChatAvailability {
  if (machineType !== "remote") return AVAILABLE;

  switch (remoteStatus?.toLowerCase()) {
    case "running":
    case "working":
      return AVAILABLE;
    case "provisioning":
      return {
        available: false,
        label: "Starting",
        reason: "This remote agent is starting. You can chat when it is online.",
      };
    case "hibernating":
      return {
        available: false,
        label: "Hibernating",
        reason: "This remote agent is hibernating. Wake it before sending a message.",
      };
    case "stopping":
      return {
        available: false,
        label: "Stopping",
        reason: "This remote agent is stopping. Start it again before sending a message.",
      };
    case "stopped":
    case "offline":
    case "archived":
      return {
        available: false,
        label: "Offline",
        reason: "This remote agent is offline. Start it before sending a message.",
      };
    case "error":
    case "blocked":
      return {
        available: false,
        label: "Unavailable",
        reason: "Aura can’t reach this remote agent. Restart it or check its status before sending.",
      };
    default:
      return {
        available: false,
        label: "Checking status",
        reason: "Checking whether this remote agent is online…",
      };
  }
}
