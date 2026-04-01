import { useParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useCronStore } from "../stores/cron-store";
import { useCronSidekickStore } from "../stores/cron-sidekick-store";
import type { CronJobRun, CronArtifact } from "../../../types";
import { ArrowLeft } from "lucide-react";
import { Button, Text } from "@cypher-asi/zui";
import { EmptyState } from "../../../components/EmptyState";
import {
  StatCard,
  SectionHeader,
  StatsGrid,
  ProgressBar,
  cx,
} from "../../../components/StatCard";
import { CronInfoTab } from "./CronInfoTab";
import styles from "../../../components/Sidekick/Sidekick.module.css";
import auraStyles from "../../../views/aura.module.css";

const EMPTY_RUNS: CronJobRun[] = [];
const EMPTY_ARTIFACTS: CronArtifact[] = [];

function RunList({ runs, onSelect }: { runs: CronJobRun[]; onSelect: (r: CronJobRun) => void }) {
  if (runs.length === 0) return <EmptyState>No runs yet</EmptyState>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {runs.map((run) => (
        <button
          key={run.run_id}
          type="button"
          onClick={() => onSelect(run)}
          style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
            background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--color-text)",
            textAlign: "left",
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: "50%",
            background: run.status === "completed" ? "var(--color-success)"
              : run.status === "failed" ? "var(--color-error)"
              : "var(--color-text-muted)",
          }} />
          <span style={{ flex: 1 }}>{run.trigger} &middot; {run.status}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {new Date(run.started_at).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

function ArtifactList({ artifacts, onSelect }: { artifacts: CronArtifact[]; onSelect: (a: CronArtifact) => void }) {
  if (artifacts.length === 0) return <EmptyState>No artifacts yet</EmptyState>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: 8 }}>
      {artifacts.map((art) => (
        <button
          key={art.artifact_id}
          type="button"
          onClick={() => onSelect(art)}
          style={{
            display: "flex", flexDirection: "column", gap: 2, padding: "6px 8px",
            borderRadius: "var(--radius-sm)", border: "1px solid var(--color-border)",
            background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--color-text)",
            textAlign: "left",
          }}
        >
          <span style={{ fontWeight: 500 }}>{art.name}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
            {art.artifact_type} &middot; {new Date(art.created_at).toLocaleString()}
          </span>
        </button>
      ))}
    </div>
  );
}

function StatsView({ runs }: { runs: CronJobRun[] }) {
  const total = runs.length;
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;
  const running = runs.filter((r) => r.status === "running").length;
  const successRate = total > 0 ? (completed / total) * 100 : 0;
  const totalTokens = runs.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);

  return (
    <div className={cx(auraStyles.dashboardPadding)}>
      <SectionHeader first>Success Rate</SectionHeader>
      <ProgressBar percentage={successRate} />

      <SectionHeader>Runs</SectionHeader>
      <StatsGrid>
        <StatCard value={total} label="Total" />
        <StatCard value={completed} label="Completed" />
        <StatCard value={failed} label="Failed" />
        <StatCard value={running} label="Running" />
      </StatsGrid>

      <SectionHeader>Usage</SectionHeader>
      <StatsGrid>
        <StatCard value={totalTokens} label="Tokens" fmt />
      </StatsGrid>
    </div>
  );
}

function RunPreview({ run, onClose }: { run: CronJobRun; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm">Run Detail</Text>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, fontSize: 13 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginBottom: 16 }}>
          <span style={{ color: "var(--color-text-muted)" }}>Status</span><span>{run.status}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Trigger</span><span>{run.trigger}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Started</span><span>{new Date(run.started_at).toLocaleString()}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Completed</span><span>{run.completed_at ? new Date(run.completed_at).toLocaleString() : "—"}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Tokens</span><span>{run.input_tokens} in / {run.output_tokens} out</span>
        </div>
        {run.error && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--color-error)" }}>Error</div>
            <div style={{ background: "var(--color-bg-input)", padding: 8, borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap" }}>{run.error}</div>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Prompt</div>
          <div style={{ background: "var(--color-bg-input)", padding: 8, borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap", maxHeight: 200, overflow: "auto" }}>
            {run.prompt_snapshot || "—"}
          </div>
        </div>
        {run.response_text && (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Response</div>
            <div style={{ background: "var(--color-bg-input)", padding: 8, borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>
              {run.response_text}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArtifactPreview({ artifact, onClose }: { artifact: CronArtifact; onClose: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
        <Button variant="ghost" size="sm" iconOnly icon={<ArrowLeft size={14} />} onClick={onClose} />
        <Text size="sm">{artifact.name}</Text>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 12, fontSize: 13 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", marginBottom: 16 }}>
          <span style={{ color: "var(--color-text-muted)" }}>Type</span><span>{artifact.artifact_type}</span>
          <span style={{ color: "var(--color-text-muted)" }}>Created</span><span>{new Date(artifact.created_at).toLocaleString()}</span>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Content</div>
          <div style={{ background: "var(--color-bg-input)", padding: 8, borderRadius: "var(--radius-sm)", whiteSpace: "pre-wrap", maxHeight: 400, overflow: "auto" }}>
            {artifact.content}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CronSidekickContent() {
  const { cronJobId } = useParams<{ cronJobId: string }>();
  const { activeTab, previewItem, viewRun, viewArtifact, closePreview } = useCronSidekickStore(
    useShallow((s) => ({
      activeTab: s.activeTab,
      previewItem: s.previewItem,
      viewRun: s.viewRun,
      viewArtifact: s.viewArtifact,
      closePreview: s.closePreview,
    })),
  );
  const runs = useCronStore((s) => (cronJobId ? s.runs[cronJobId] ?? EMPTY_RUNS : EMPTY_RUNS));
  const artifacts = useCronStore((s) => (cronJobId ? s.artifacts[cronJobId] ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS));

  if (!cronJobId) {
    return (
      <div className={styles.sidekickBody}>
        <EmptyState>Select a cron job</EmptyState>
      </div>
    );
  }

  if (previewItem) {
    return (
      <div className={styles.sidekickBody}>
        <div className={styles.previewOverlay}>
          {previewItem.kind === "run" && <RunPreview run={previewItem.run} onClose={closePreview} />}
          {previewItem.kind === "artifact" && <ArtifactPreview artifact={previewItem.artifact} onClose={closePreview} />}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sidekickBody}>
      <div className={styles.sidekickContent}>
        <div className={styles.tabContent}>
          {activeTab === "cron" && <CronInfoTab />}
          {activeTab === "runs" && <RunList runs={runs} onSelect={viewRun} />}
          {activeTab === "artifacts" && <ArtifactList artifacts={artifacts} onSelect={viewArtifact} />}
          {activeTab === "stats" && <StatsView runs={runs} />}
          {activeTab === "log" && (
            <EmptyState>Activity log coming soon</EmptyState>
          )}
        </div>
      </div>
    </div>
  );
}
