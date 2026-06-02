import {
  getAdapterLabel,
  getConnectionAuthLabel,
} from "../../../lib/integrationCatalog";

// `AnnotatedSession` now lives in the shared sessions list module
// (`components/SessionsList/session-row-utils.ts`) so both the agents
// `ChatsTab` and the projects `SessionsList` sidekick share one shape.

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
    case "aura_managed":
    default:
      return "Managed by Aura";
  }
}

export function formatAgentIdShort(agentId: string): string {
  if (agentId.length <= 14) return agentId;
  return `${agentId.slice(0, 8)}…${agentId.slice(-4)}`;
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * ChatGPT-style date bucket label for a session timestamp.
 * Returns a stable string suitable for grouping and as a section header.
 */
export function getDateBucket(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const todayStart = startOfDay(now);
  const dayMs = 86_400_000;
  const dateStart = startOfDay(date);
  const diffDays = Math.round((todayStart - dateStart) / dayMs);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Previous 7 Days";
  if (diffDays < 30) return "Previous 30 Days";
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}
