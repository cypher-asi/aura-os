export type FeatureHealthStatus =
  | "operational"
  | "degraded"
  | "partial_outage"
  | "major_outage"
  | "unknown"
  | "maintenance";

export type StatusCheckState = "pass" | "warn" | "fail" | "skip" | "unknown";

export interface StatusInvestigationItem {
  readonly label: string;
  readonly command?: string;
  readonly path?: string;
  readonly reason?: string;
  readonly details?: string;
  readonly steps?: readonly string[];
}

export interface StatusInvestigation {
  readonly schemaVersion: 1;
  readonly kind: "llm-investigation";
  readonly id: string;
  readonly featureId: string | null;
  readonly featureLabel: string;
  readonly checkId: string;
  readonly title: string;
  readonly status: "ready" | "failed" | "skipped";
  readonly checkStatus: StatusCheckState | null;
  readonly featureStatus: FeatureHealthStatus | null;
  readonly generatedAt: string;
  readonly environment?: string;
  readonly source?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly confidence: "low" | "medium" | "high";
  readonly summary: string;
  readonly rootCause: string;
  readonly proof: readonly string[];
  readonly possibleCauses: readonly string[];
  readonly reproductionSteps: readonly StatusInvestigationItem[];
  readonly affectedAreas: readonly StatusInvestigationItem[];
  readonly whatWouldDisproveThis?: readonly string[];
  readonly recommendedVerifierProbes?: readonly StatusInvestigationItem[];
  readonly recommendedNextActions: readonly string[];
  readonly followUpEvals: readonly string[];
  readonly evidenceDigest?: Record<string, unknown>;
  readonly error?: string;
}

export interface StatusCheck {
  readonly id: string;
  readonly required: boolean;
  readonly status: StatusCheckState;
  readonly featureStatus: FeatureHealthStatus;
  readonly message: string;
  readonly checkedAt: string | null;
  readonly latencyMs: number | null;
  readonly evidence: Record<string, unknown>;
  readonly investigation?: StatusInvestigation;
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
    readonly investigations?: number;
  };
  readonly features: readonly StatusFeature[];
  readonly investigations?: readonly StatusInvestigation[];
}

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
  return fetchStatusSnapshot(PUBLISHED_STATUS_JSON_URL);
}
