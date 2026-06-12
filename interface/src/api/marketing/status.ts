export type FeatureHealthStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "unknown"
  | "maintenance";

export type StatusCheckState = "pass" | "warn" | "fail" | "skip" | "unknown";

export interface StatusCheck {
  readonly id: string;
  readonly required: boolean;
  readonly status: StatusCheckState;
  readonly featureStatus: FeatureHealthStatus;
  readonly message: string;
  readonly checkedAt: string | null;
  readonly latencyMs: number | null;
  readonly evidence: Record<string, unknown>;
}

export interface StatusFeature {
  readonly id: string;
  readonly label: string;
  readonly category: string;
  readonly priority: number;
  readonly description: string;
  readonly publicSummary: string;
  readonly status: FeatureHealthStatus;
  readonly lastCheckedAt: string | null;
  readonly checksPassed: number;
  readonly checksTotal: number;
  readonly checksFailed: number;
  readonly checksUnknown: number;
  readonly latencyP95Ms: number | null;
  readonly message: string;
  readonly checks: readonly StatusCheck[];
}

export interface StatusSnapshot {
  readonly schemaVersion: 1;
  readonly title: string;
  readonly description: string;
  readonly generatedAt: string;
  readonly environment: string;
  readonly source: string;
  readonly overall: FeatureHealthStatus;
  readonly totals: {
    readonly features: number;
    readonly operational: number;
    readonly degraded: number;
    readonly partialOutage: number;
    readonly majorOutage: number;
    readonly unknown: number;
    readonly maintenance: number;
  };
  readonly features: readonly StatusFeature[];
}

const LOCAL_STATUS_JSON_URL = "/observability/status.json";
const PUBLISHED_STATUS_JSON_URL =
  import.meta.env.VITE_AURA_STATUS_SNAPSHOT_URL ||
  "https://cypher-asi.github.io/aura-os/observability/status.json";

async function fetchStatusSnapshot(url: string): Promise<StatusSnapshot> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Status snapshot failed with HTTP ${response.status}`);
  }
  return response.json() as Promise<StatusSnapshot>;
}

export async function getStatusSnapshot(): Promise<StatusSnapshot> {
  try {
    return await fetchStatusSnapshot(PUBLISHED_STATUS_JSON_URL);
  } catch (publishedError) {
    try {
      return await fetchStatusSnapshot(LOCAL_STATUS_JSON_URL);
    } catch (localError) {
      const message =
        publishedError instanceof Error ? publishedError.message : String(publishedError);
      const localMessage = localError instanceof Error ? localError.message : String(localError);
      throw new Error(`${message}; local fallback failed: ${localMessage}`);
    }
  }
}
