import type { Agent, Session } from "../../../types";
import {
  getAdapterLabel,
  getConnectionAuthLabel,
  getLocalAuthLabel,
} from "../../../lib/integrationCatalog";

export interface RuntimeReadiness {
  tone: "info" | "success" | "warning";
  title: string;
  message: string;
}

export type AnnotatedSession = Session & {
  _projectName: string;
  _projectId: string;
  _agentInstanceId: string;
};

export function formatAdapterLabel(adapterType?: string | null): string {
  return getAdapterLabel(adapterType ?? "aura_harness");
}

export function formatAuthSourceLabel(
  authSource?: string | null,
  adapterType?: string | null,
): string {
  switch (authSource) {
    case "org_integration":
      return getConnectionAuthLabel(adapterType ?? "aura_harness");
    case "local_cli_auth":
      return getLocalAuthLabel(adapterType ?? "aura_harness");
    case "aura_managed":
    default:
      return "Managed by Aura";
  }
}

export function formatRunsOnLabel(
  environment?: string | null,
  machineType?: string | null,
): string {
  const effective =
    environment || (machineType === "remote" ? "swarm_microvm" : "local_host");
  switch (effective) {
    case "swarm_microvm":
      return "Isolated Cloud Runtime";
    case "local_host":
    default:
      return "This Machine";
  }
}

export function describeRuntimeReadiness(
  agent: Agent,
  integration?: { name: string; has_secret: boolean } | null,
): RuntimeReadiness {
  if (agent.auth_source === "org_integration") {
    if (!integration) {
      return {
        tone: "warning",
        title: "Connection missing",
        message:
          "This agent expects a workspace connection, but none is currently attached. Attach one before running the agent.",
      };
    }
    if (!integration.has_secret) {
      return {
        tone: "warning",
        title: "Connection missing a key",
        message: `${integration.name} is attached, but it does not have a stored key yet. Add one in Connections before running this agent.`,
      };
    }
    return {
      tone: "success",
      title: "Connection ready",
      message: `${integration.name} has a stored key. Keys stay in Connections and are resolved only at runtime.`,
    };
  }

  if (agent.auth_source === "local_cli_auth") {
    return {
      tone: "info",
      title: "Uses a local login",
      message: `${getLocalAuthLabel(agent.adapter_type ?? "aura_harness")} uses the login available to aura-os-server on this machine.`,
    };
  }

  return {
    tone: "success",
    title: "Managed by Aura",
    message:
      "Aura provides the credentials and billing for this runtime path.",
  };
}

export function formatDuration(
  startedAt: string,
  endedAt: string | null,
): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}
