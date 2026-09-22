import { useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { buildAgentSessionRoute } from "../../../shared/lib/agent-session-route";
import {
  cancelChatCommandReplay,
  retryChatCommandNow,
  useChatCommandOutboxStore,
  type PendingChatCommand,
} from "../../../stores/chat-command-outbox";
import styles from "./PendingAgentSends.module.css";

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

function commandPreview(command: PendingChatCommand): string {
  const content = command.content.trim().replace(/\s+/g, " ");
  if (!content) return "Agent command";
  return content.length <= 72 ? content : `${content.slice(0, 71)}…`;
}

function commandStatus(command: PendingChatCommand): string {
  if (command.executionStatus === "failed") return "Agent run failed";
  if (command.executionStatus === "unconfirmed") return "Agent run unconfirmed";
  if (command.accepted) return "Checking agent run";
  return "Waiting to send";
}

export function PendingAgentSends() {
  const navigate = useNavigate();
  const commands = useChatCommandOutboxStore((state) => state.commands);
  const [busyCommandId, setBusyCommandId] = useState<string | null>(null);

  if (commands.length === 0) return null;

  const run = (commandId: string, operation: () => Promise<unknown>) => {
    setBusyCommandId(commandId);
    void operation().finally(() => {
      setBusyCommandId((current) => current === commandId ? null : current);
    });
  };

  return (
    <section className={styles.root} aria-label="Unconfirmed agent sends">
      <div className={styles.header}>
        <div>
          <div className={styles.title}>
            {commands.length} {commands.length === 1 ? "message" : "messages"} to check
          </div>
          <div className={styles.subtitle}>Saved on this device until Aura confirms the agent run.</div>
        </div>
      </div>
      <div className={styles.list}>
        {commands.map((command) => {
          const route = commandRoute(command);
          const preview = commandPreview(command);
          const isBusy = busyCommandId === command.commandId;
          return (
            <article className={styles.item} key={command.commandId}>
              <button
                type="button"
                className={styles.openButton}
                onClick={() => route && navigate(route)}
                disabled={!route}
                aria-label={`Open conversation for: ${preview}`}
              >
                <span className={styles.preview}>{preview}</span>
                <ExternalLink size={14} aria-hidden="true" />
              </button>
              <div className={styles.status} role="status">{commandStatus(command)}</div>
              <div className={styles.actions}>
                {command.executionStatus !== "failed" && <button
                  type="button"
                  className={styles.action}
                  disabled={isBusy}
                  onClick={() => run(
                    command.commandId,
                    () => retryChatCommandNow(command.commandId),
                  )}
                  aria-label={`${command.accepted ? "Check run" : "Retry now"}: ${preview}`}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {command.accepted ? "Check" : "Retry"}
                </button>}
                <button
                  type="button"
                  className={styles.action}
                  disabled={isBusy}
                  onClick={() => run(
                    command.commandId,
                    () => cancelChatCommandReplay(command.commandId),
                  )}
                  aria-label={`${command.accepted ? "Dismiss run status" : "Stop retrying"}: ${preview}`}
                >
                  <X size={14} aria-hidden="true" />
                  {command.accepted ? "Dismiss" : "Remove"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
