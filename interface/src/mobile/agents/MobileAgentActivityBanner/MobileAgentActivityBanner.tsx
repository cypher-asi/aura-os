import { CircleAlert, CircleHelp, LoaderCircle, Send } from "lucide-react";
import { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  buildAgentSessionRoute,
  isAgentSessionRouteCurrent,
} from "../../../shared/lib/agent-session-route";
import {
  hydrateAgentAttention,
  useAgentAttentionStore,
} from "../../../stores/agent-attention-store";
import {
  useChatCommandOutboxStore,
  type PendingChatCommand,
} from "../../../stores/chat-command-outbox";
import styles from "./MobileAgentActivityBanner.module.css";

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
  const currentUrl = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (!attentionHydrated) void hydrateAgentAttention();
  }, [attentionHydrated]);

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
      .filter(({ route }) => !isAgentSessionRouteCurrent(route, currentUrl))
      .sort((a, b) => a.command.createdAt - b.command.createdAt);
    const runs = Object.values(activeRuns)
      .filter(
        (item) =>
          item &&
          !isAgentSessionRouteCurrent(item.route, currentUrl) &&
          (!item.route || !blockedRoutes.has(item.route)),
      )
      .sort((a, b) => a!.startedAt - b!.startedAt);

    const inputCount = inputs.length;
    const approvalCount = approvals.length;
    const waitingCount = waitingCommands.length;
    const runCount = runs.length;
    const labels = [
      countLabel(inputCount, "answer needed", "answers needed"),
      countLabel(approvalCount, "approval waiting", "approvals waiting"),
      countLabel(waitingCount, "message waiting to send", "messages waiting to send"),
      countLabel(runCount, "agent working", "agents working"),
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
      return {
        route: waitingCommands[0].route ?? "/agents",
        label: labels.join(" · "),
        action: "Open pending message",
        kind: "outbox" as const,
      };
    }
    return {
      route: runs[0]?.route ?? "/agents",
      label: labels.join(" · "),
      action: "Open active agent",
      kind: "working" as const,
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

  return (
    <button
      type="button"
      className={styles.root}
      data-kind={model.kind}
      onClick={() => navigate(model.route)}
      aria-label={`${model.label}. ${model.action}`}
    >
      <Icon
        className={model.kind === "working" ? styles.spinning : undefined}
        size={16}
        aria-hidden="true"
      />
      <span>{model.label}</span>
    </button>
  );
}
