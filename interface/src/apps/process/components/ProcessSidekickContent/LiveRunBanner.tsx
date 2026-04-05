import { useProcessStore } from "../../stores/process-store";
import { useProcessSidekickStore } from "../../stores/process-sidekick-store";
import { useAgentStore } from "../../../agents/stores/agent-store";
import { formatTokensCompact as formatTokens, formatCost } from "../../../../utils/format";
import type { ProcessEvent, ProcessRun } from "../../../../types";
import { injectKeyframes, useElapsedTime, EMPTY_NODES } from "./process-sidekick-utils";

export interface LiveRunBannerProps {
  run: ProcessRun;
  events: ProcessEvent[];
  totalNodes: number;
}

export function LiveRunBanner({ run, events, totalNodes }: LiveRunBannerProps) {
  injectKeyframes();
  const liveRunNodeId = useProcessSidekickStore((s) => s.liveRunNodeId);
  const nodes = useProcessStore((s) => s.nodes[run.process_id]) ?? EMPTY_NODES;
  const agents = useAgentStore((s) => s.agents);
  const elapsed = useElapsedTime(run.started_at, true);

  const completedCount = events.filter(
    (e) => e.status === "completed" || e.status === "failed" || e.status === "skipped",
  ).length;

  const currentNode = liveRunNodeId ? nodes.find((n) => n.node_id === liveRunNodeId) : null;
  const currentAgent = currentNode?.agent_id
    ? agents.find((a) => a.agent_id === currentNode.agent_id)
    : null;

  const runningTokens = events.reduce(
    (acc, e) => ({
      input: acc.input + (e.input_tokens ?? 0),
      output: acc.output + (e.output_tokens ?? 0),
    }),
    { input: 0, output: 0 },
  );
  const totalTokens = runningTokens.input + runningTokens.output;
  const estimatedCost = runningTokens.input * 3 / 1_000_000 + runningTokens.output * 15 / 1_000_000;

  return (
    <div style={{
      padding: "10px 12px",
      borderBottom: "1px solid var(--color-border)",
      background: "rgba(59,130,246,0.04)",
    }}>
      <BannerHeader elapsed={elapsed} />
      <BannerProgress completedCount={completedCount} totalNodes={totalNodes} />
      {currentNode && (
        <div style={{ fontSize: 12, color: "var(--color-text-muted)", marginBottom: 4 }}>
          {currentAgent ? (
            <><span style={{ fontWeight: 600, color: "var(--color-text)" }}>{currentAgent.name}</span> working on </>
          ) : null}
          <span style={{ fontWeight: 500 }}>{currentNode.label}</span>
        </div>
      )}
      {totalTokens > 0 && (
        <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--color-text-muted)" }}>
          <span>{formatTokens(totalTokens)} tokens</span>
          <span>~{formatCost(estimatedCost, 3)}</span>
        </div>
      )}
    </div>
  );
}

function BannerHeader({ elapsed }: { elapsed: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%", background: "#3b82f6",
        animation: "aura-pulse 1.5s ease-in-out infinite", flexShrink: 0,
      }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: "#3b82f6" }}>Running</span>
      <span style={{
        fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono)",
        color: "var(--color-text)", marginLeft: "auto",
      }}>
        {elapsed}
      </span>
    </div>
  );
}

function BannerProgress({ completedCount, totalNodes }: { completedCount: number; totalNodes: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <div style={{
        flex: 1, height: 4, borderRadius: 2,
        background: "rgba(59,130,246,0.15)", overflow: "hidden",
      }}>
        <div style={{
          width: totalNodes > 0 ? `${(completedCount / totalNodes) * 100}%` : "0%",
          height: "100%", borderRadius: 2, background: "#3b82f6",
          transition: "width 0.5s ease-out",
        }} />
      </div>
      <span style={{ fontSize: 11, color: "var(--color-text-muted)", flexShrink: 0 }}>
        {completedCount}/{totalNodes}
      </span>
    </div>
  );
}
