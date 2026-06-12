import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Gauge,
  RefreshCw,
  Server,
  XCircle,
} from "lucide-react";

import {
  getStatusSnapshot,
  type FeatureHealthStatus,
  type StatusCheck,
  type StatusFeature,
  type StatusSnapshot,
} from "../../../api/marketing/status";

import "./StatusView.css";

const STATUS_LABELS: Record<FeatureHealthStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  partial_outage: "Partial Outage",
  major_outage: "Major Outage",
  unknown: "Unknown",
  maintenance: "Maintenance",
};

const CATEGORY_LABELS: Record<string, string> = {
  agents: "Agents",
  automation: "Automation",
  media: "Media",
  models: "Models",
  platform: "Platform",
  website: "Website",
};

const FALLBACK_SNAPSHOT: StatusSnapshot = {
  schemaVersion: 1,
  title: "AURA Observability",
  description: "Live evals and feature health backed by AURA-owned probes.",
  generatedAt: new Date(0).toISOString(),
  environment: "unknown",
  source: "not-published",
  overall: "unknown",
  totals: {
    features: 0,
    operational: 0,
    degraded: 0,
    partialOutage: 0,
    majorOutage: 0,
    unknown: 0,
    maintenance: 0,
  },
  features: [],
};

function statusIcon(status: FeatureHealthStatus, size = 16): ReactNode {
  switch (status) {
    case "operational":
      return <CheckCircle2 size={size} strokeWidth={1.9} />;
    case "degraded":
    case "maintenance":
      return <AlertTriangle size={size} strokeWidth={1.9} />;
    case "partial_outage":
    case "major_outage":
      return <XCircle size={size} strokeWidth={1.9} />;
    case "unknown":
    default:
      return <Clock3 size={size} strokeWidth={1.9} />;
  }
}

function checkStatusClass(status: StatusCheck["status"]): string {
  if (status === "pass") return "statusCheckPass";
  if (status === "warn") return "statusCheckWarn";
  if (status === "fail") return "statusCheckFail";
  if (status === "skip") return "statusCheckSkip";
  return "statusCheckUnknown";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "No run yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return "No run yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatLatency(value: number | null): string {
  if (value == null) return "-";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)} s`;
}

function featureGroups(features: readonly StatusFeature[]): Array<[string, StatusFeature[]]> {
  const groups = new Map<string, StatusFeature[]>();
  for (const feature of features) {
    const key = feature.category || "other";
    groups.set(key, [...(groups.get(key) ?? []), feature]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function extractEvidence(check: StatusCheck): string {
  const evidence = check.evidence ?? {};
  if (typeof evidence.passed === "number" && typeof evidence.total === "number") {
    return `${evidence.passed}/${evidence.total}`;
  }
  if (typeof evidence.frameTypes === "object" && evidence.frameTypes !== null) {
    return "SSE";
  }
  if (typeof evidence.remoteState === "string") return evidence.remoteState;
  if (typeof evidence.model === "string") return evidence.model;
  if (typeof evidence.overall === "string") return evidence.overall;
  if (typeof evidence.status === "string") return evidence.status;
  return Object.keys(evidence).length > 0 ? "Captured" : "-";
}

function StatusBadge({ status }: { readonly status: FeatureHealthStatus }): ReactNode {
  return (
    <span className={`statusBadge statusBadge-${status}`}>
      {statusIcon(status)}
      {STATUS_LABELS[status]}
    </span>
  );
}

function SummaryMetric({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string | number;
  readonly icon: ReactNode;
}): ReactNode {
  return (
    <div className="statusMetric">
      <span className="statusMetricIcon" aria-hidden>
        {icon}
      </span>
      <span className="statusMetricValue">{value}</span>
      <span className="statusMetricLabel">{label}</span>
    </div>
  );
}

function CheckRows({ checks }: { readonly checks: readonly StatusCheck[] }): ReactNode {
  return (
    <div className="statusChecks" role="table" aria-label="Feature checks">
      <div className="statusCheckHeader" role="row">
        <span role="columnheader">Check</span>
        <span role="columnheader">State</span>
        <span role="columnheader">Latency</span>
        <span role="columnheader">Evidence</span>
      </div>
      {checks.map((check) => (
        <div className="statusCheckRow" role="row" key={check.id}>
          <span className="statusCheckName" role="cell">
            {check.id}
            {!check.required && <span className="statusOptional">Optional</span>}
          </span>
          <span className={`statusCheckState ${checkStatusClass(check.status)}`} role="cell">
            {check.status}
          </span>
          <span role="cell">{formatLatency(check.latencyMs)}</span>
          <span role="cell">{extractEvidence(check)}</span>
        </div>
      ))}
    </div>
  );
}

function FeatureRow({ feature }: { readonly feature: StatusFeature }): ReactNode {
  return (
    <article className="statusFeature">
      <div className="statusFeatureTop">
        <div className="statusFeatureTitle">
          <h3>{feature.label}</h3>
          <p>{feature.publicSummary}</p>
        </div>
        <StatusBadge status={feature.status} />
      </div>
      <div className="statusFeatureMeta" aria-label={`${feature.label} metrics`}>
        <span>{feature.checksPassed}/{feature.checksTotal} checks</span>
        <span>{formatLatency(feature.latencyP95Ms)} p95</span>
        <span>{formatTimestamp(feature.lastCheckedAt)}</span>
      </div>
      <p className="statusFeatureMessage">{feature.message}</p>
      <CheckRows checks={feature.checks} />
    </article>
  );
}

export function StatusView(): ReactNode {
  const [snapshot, setSnapshot] = useState<StatusSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "AURA - Observability";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getStatusSnapshot()
      .then((payload) => {
        if (!active) return;
        setSnapshot(payload);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setSnapshot(FALLBACK_SNAPSHOT);
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const activeSnapshot = snapshot ?? FALLBACK_SNAPSHOT;
  const groupedFeatures = useMemo(
    () => featureGroups(activeSnapshot.features),
    [activeSnapshot.features],
  );
  const passingChecks = activeSnapshot.features.reduce(
    (sum, feature) => sum + feature.checksPassed,
    0,
  );
  const totalChecks = activeSnapshot.features.reduce(
    (sum, feature) => sum + feature.checksTotal,
    0,
  );
  const avgLatency = useMemo(() => {
    const latencies = activeSnapshot.features
      .map((feature) => feature.latencyP95Ms)
      .filter((value): value is number => typeof value === "number");
    if (latencies.length === 0) return null;
    return latencies.reduce((sum, value) => sum + value, 0) / latencies.length;
  }, [activeSnapshot.features]);

  return (
    <main className="statusPage">
      <section className="statusHero" aria-labelledby="status-title">
        <div className="statusHeroCopy">
          <span className="statusEyebrow">Live evals</span>
          <h1 id="status-title">AURA Observability</h1>
          <p>
            Runtime probes exercise agent creation, remote runtimes, model
            responses, media generation, and public routes.
          </p>
        </div>
        <div className="statusOverallPanel" aria-label="Overall status">
          <StatusBadge status={activeSnapshot.overall} />
          <span className="statusOverallText">{STATUS_LABELS[activeSnapshot.overall]}</span>
          <span className="statusUpdated">
            Updated {formatTimestamp(activeSnapshot.generatedAt)}
          </span>
        </div>
      </section>

      <section className="statusSummary" aria-label="Status summary">
        <SummaryMetric
          label="Features"
          value={activeSnapshot.totals.features}
          icon={<Server size={18} strokeWidth={1.8} />}
        />
        <SummaryMetric
          label="Passing checks"
          value={`${passingChecks}/${totalChecks}`}
          icon={<CheckCircle2 size={18} strokeWidth={1.8} />}
        />
        <SummaryMetric
          label="Average p95"
          value={formatLatency(avgLatency)}
          icon={<Gauge size={18} strokeWidth={1.8} />}
        />
        <SummaryMetric
          label={activeSnapshot.environment}
          value={loading ? "Loading" : activeSnapshot.source}
          icon={<Activity size={18} strokeWidth={1.8} />}
        />
      </section>

      {error && (
        <div className="statusNotice" role="status">
          <AlertTriangle size={16} strokeWidth={1.9} aria-hidden />
          Snapshot not published yet: {error}
        </div>
      )}

      <section className="statusGroups" aria-label="Feature health">
        {groupedFeatures.length === 0 ? (
          <div className="statusEmpty">
            <RefreshCw size={18} strokeWidth={1.8} aria-hidden />
            No status snapshot has been published.
          </div>
        ) : (
          groupedFeatures.map(([category, features]) => (
            <section className="statusGroup" key={category} aria-labelledby={`status-${category}`}>
              <h2 id={`status-${category}`}>{CATEGORY_LABELS[category] ?? category}</h2>
              <div className="statusFeatureList">
                {features.map((feature) => (
                  <FeatureRow key={feature.id} feature={feature} />
                ))}
              </div>
            </section>
          ))
        )}
      </section>
    </main>
  );
}
