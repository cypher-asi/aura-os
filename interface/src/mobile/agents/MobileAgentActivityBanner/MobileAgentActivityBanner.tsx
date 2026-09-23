import { CircleAlert, CircleHelp, LoaderCircle, Send, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { api } from "../../../api/client";
import {
  buildAgentSessionRoute,
  isAgentSessionRouteCurrent,
} from "../../../shared/lib/agent-session-route";
import {
  hydrateAgentAttention,
  markAgentRunStopped,
  refreshAgentRunActivity,
  type AgentActiveRunItem,
  useAgentAttentionStore,
} from "../../../stores/agent-attention-store";
import {
  useChatCommandOutboxStore,
  type PendingChatCommand,
} from "../../../stores/chat-command-outbox";
import styles from "./MobileAgentActivityBanner.module.css";

const ACTIVE_RUN_REFRESH_MS = 10_000;

function commandRoute(command: PendingChatCommand): string | undefined {
  return command.surface === "project"
    ? buildAgentSessionRoute({
        projectId: command.projectId,
        agentInstanceId: command.agentInstanceId,
        sessionId: command.sessionId,
      })
    : buildAgentSessionRoute({
        projectId: command.projectId,
        agentId: command.agentId,
        sessionId: command.sessionId,
      });
}

function countLabel(count: number, singular: string, plural: string): string | null {
  if (count === 0) return null;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function MobileAgentActivityBanner() {
  const navigate = useNavigate();
  const location = useLocation();
  const pendingApprovals = useAgentAttentionStore((state) => state.pendingApprovals);
  const pendingInputs = useAgentAttentionStore((state) => state.pendingInputs);
  const activeRuns = useAgentAttentionStore((state) => state.activeRuns);
  const attentionHydrated = useAgentAttentionStore((state) => state.hydrated);
  const commands = useChatCommandOutboxStore((state) => state.commands);
  const [stoppingRoute, setStoppingRoute] = useState<string | null>(null);
  const [stopErrorRoute, setStopErrorRoute] = useState<string | null>(null);
  const currentUrl = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!attentionHydrated) void hydrateAgentAttention();
  }, [attentionHydrated]);

  const activeRunCount = Object.values(activeRuns).filter(Boolean).length;
  useEffect(() => {
    if (activeRunCount === 0) return;
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void refreshAgentRunActivity().catch(() => {});
    };
    const interval = window.setInterval(refresh, ACTIVE_RUN_REFRESH_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [activeRunCount]);

  const model = useMemo(() => {
    const approvals = Object.values(pendingApprovals)
      .filter((item) => item && !isAgentSessionRouteCurrent(item.route, currentUrl))
      .sort((a, b) => a!.startedAt - b!.startedAt);
    const inputs = Object.values(pendingInputs)
      .filter((item) => item && !isAgentSessionRouteCurrent(item.route, currentUrl))
      .sort((a, b) => a!.startedAt - b!.startedAt);
    const blockedRoutes = new Set(
      [...Object.values(pendingInputs), ...Object.values(pendingApprovals)]
        .flatMap((item) => item?.route ? [item.route] : []),
    );
    const waitingCommands = commands
      .map((command) => ({ command, route: commandRoute(command) }))
      .filter(({ command, route }) =>
        !isAgentSessionRouteCurrent(route, currentUrl) &&
        (!command.accepted || command.executionStatus === "unconfirmed" ||
          command.executionStatus === "failed"))
      .sort((a, b) => {
        const rank = (command: PendingChatCommand) =>
          command.executionStatus === "failed" ? 0 :
          command.executionStatus === "unconfirmed" ? 1 : 2;
        return rank(a.command) - rank(b.command) ||
          a.command.createdAt - b.command.createdAt;
      });
    const runs = Object.values(activeRuns)
      .filter(
        (item): item is AgentActiveRunItem => Boolean(
          item &&
          !isAgentSessionRouteCurrent(item.route, currentUrl) &&
          (!item.route || !blockedRoutes.has(item.route)),
        ),
      )
      .sort((a, b) => a.startedAt - b.startedAt);

    const inputCount = inputs.length;
    const approvalCount = approvals.length;
    const waitingCount = waitingCommands.filter(({ command }) => !command.accepted).length;
    const unconfirmedCount = waitingCommands.filter(({ command }) =>
      command.executionStatus === "unconfirmed").length;
    const failedCount = waitingCommands.filter(({ command }) =>
      command.executionStatus === "failed").length;
    const runCount = runs.length;
    const currentActivity = runs[0]?.activity;
    const activeSubagentCount = runs.reduce(
      (total, run) => total + (run.activeSubagentCount ?? 0),
      0,
    );
    const labels = [
      countLabel(inputCount, "answer needed", "answers needed"),
      countLabel(approvalCount, "approval waiting", "approvals waiting"),
      countLabel(waitingCount, "message waiting to send", "messages waiting to send"),
      countLabel(unconfirmedCount, "agent run unconfirmed", "agent runs unconfirmed"),
      countLabel(failedCount, "agent run failed", "agent runs failed"),
      countLabel(runCount, "agent working", "agents working"),
      countLabel(activeSubagentCount, "child agent active", "child agents active"),
      currentActivity ?? null,
    ].filter((label): label is string => label !== null);

    if (labels.length === 0) return null;
    if (inputs[0]) {
      return {
        route: inputs[0].route ?? "/agents",
        label: labels.join(" · "),
        action: "Open agent question",
        kind: "input" as const,
      };
    }
    if (approvals[0]) {
      return {
        route: approvals[0].route ?? "/agents",
        label: labels.join(" · "),
        action: "Open waiting approval",
        kind: "approval" as const,
      };
    }
    if (waitingCommands[0]) {
      const firstStatus = waitingCommands[0].command.executionStatus;
      return {
        route: waitingCommands[0].route ?? "/agents",
        label: labels.join(" · "),
        action: firstStatus === "failed" ? "Open failed agent run" :
          firstStatus === "unconfirmed" ? "Open unconfirmed agent run" :
          "Open pending message",
        kind: "outbox" as const,
      };
    }
    return {
      route: runs[0]?.route ?? "/agents",
      label: labels.join(" · "),
      action: "Open active agent",
      kind: "working" as const,
      run: runs[0] as AgentActiveRunItem,
    };
  }, [activeRuns, commands, currentUrl, pendingApprovals, pendingInputs]);

  if (!model) return null;

  const Icon = model.kind === "input"
    ? CircleHelp
    : model.kind === "approval"
      ? CircleAlert
    : model.kind === "outbox"
      ? Send
      : LoaderCircle;
  const isStopping = model.kind === "working" && stoppingRoute === model.route;
  const stopFailed = model.kind === "working" && stopErrorRoute === model.route;

  const stopRun = async () => {
    if (model.kind !== "working") return;
    setStoppingRoute(model.route);
    setStopErrorRoute(null);
    try {
      if (model.run.projectId && model.run.agentInstanceId) {
        await api.cancelInstanceTurn(
          model.run.projectId,
          model.run.agentInstanceId,
          model.run.sessionId,
        );
      } else {
        await api.agents.cancelTurn(model.run.agentId, model.run.sessionId);
      }
      markAgentRunStopped(model.run);
    } catch {
      setStopErrorRoute(model.route);
    } finally {
      setStoppingRoute(null);
    }
  };

  return (
    <div
      className={styles.root}
      data-kind={model.kind}
    >
      <button
        type="button"
        className={styles.openButton}
        data-kind={model.kind}
        onClick={() => navigate(model.route)}
        aria-label={`${model.label}. ${model.action}`}
      >
        <Icon
          className={model.kind === "working" ? styles.spinning : undefined}
          size={16}
          aria-hidden="true"
        />
        <span>{stopFailed ? `${model.label} · Stop failed` : model.label}</span>
      </button>
      {model.kind === "working" ? (
        <button
          type="button"
          className={styles.stopButton}
          onClick={() => void stopRun()}
          disabled={isStopping}
          aria-label={isStopping ? "Stopping active agent" : "Stop active agent"}
        >
          <Square size={13} fill="currentColor" aria-hidden="true" />
          <span>{isStopping ? "Stopping…" : "Stop"}</span>
        </button>
      ) : null}
    </div>
  );
}
