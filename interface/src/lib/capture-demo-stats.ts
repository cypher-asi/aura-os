import type { ProjectStatsData } from "../shared/api/projects";

export const AURA_CAPTURE_PROJECT_STATS_STORAGE_KEY = "aura:captureDemoProjectStats";

interface CaptureDemoProjectStatsPayload {
  projectId: string;
  stats: ProjectStatsData;
  expiresAt: number;
}

function storage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage ?? null;
}

export function writeCaptureDemoProjectStats(
  projectId: string,
  stats: ProjectStatsData,
  ttlMs = 30 * 60 * 1000,
): void {
  const target = storage();
  if (!target) return;

  const payload: CaptureDemoProjectStatsPayload = {
    projectId,
    stats,
    expiresAt: Date.now() + ttlMs,
  };
  target.setItem(AURA_CAPTURE_PROJECT_STATS_STORAGE_KEY, JSON.stringify(payload));
}

export function readCaptureDemoProjectStats(projectId: string | null): ProjectStatsData | null {
  const target = storage();
  if (!target || !projectId) return null;

  try {
    const raw = target.getItem(AURA_CAPTURE_PROJECT_STATS_STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as Partial<CaptureDemoProjectStatsPayload>;
    if (payload.projectId !== projectId || !payload.stats) return null;
    if (typeof payload.expiresAt === "number" && payload.expiresAt < Date.now()) {
      target.removeItem(AURA_CAPTURE_PROJECT_STATS_STORAGE_KEY);
      return null;
    }
    return payload.stats;
  } catch {
    target.removeItem(AURA_CAPTURE_PROJECT_STATS_STORAGE_KEY);
    return null;
  }
}
