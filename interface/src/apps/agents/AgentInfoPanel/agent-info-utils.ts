import type { Session } from "../../../types";
import {
  getAdapterLabel,
  getConnectionAuthLabel,
  getLocalAuthLabel,
} from "../../../lib/integrationCatalog";

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
