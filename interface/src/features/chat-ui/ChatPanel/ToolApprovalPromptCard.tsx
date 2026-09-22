import { useMemo, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { streamsApi } from "../../../shared/api/streams";
import type {
  ToolApprovalDecision,
  ToolApprovalPrompt,
  ToolApprovalRemember,
} from "../../../shared/types/harness-protocol";
import {
  clearPendingToolApproval,
  useToolApprovalStore,
} from "../../../stores/tool-approval-store";
import styles from "./ToolApprovalPromptCard.module.css";

interface ToolApprovalPromptCardProps {
  streamKey: string;
}

const REMEMBER_LABELS: Record<ToolApprovalRemember, string> = {
  once: "This time only",
  session: "For this chat",
  forever: "Always for this agent",
};

function displayToolName(toolName: string): string {
  return toolName.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatArgs(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === 0) {
    return null;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function ToolApprovalPromptCard({ streamKey }: ToolApprovalPromptCardProps) {
  const prompt = useToolApprovalStore((state) => state.prompts[streamKey]);
  if (!prompt) return null;
  return <ToolApprovalPromptContent key={prompt.request_id} streamKey={streamKey} prompt={prompt} />;
}

function ToolApprovalPromptContent({
  streamKey,
  prompt,
}: ToolApprovalPromptCardProps & { prompt: ToolApprovalPrompt }) {
  const options = useMemo<ToolApprovalRemember[]>(() => {
    const offered = prompt.remember_options;
    return offered.length > 0 ? Array.from(new Set(offered)) : ["once"];
  }, [prompt]);
  const [remember, setRemember] = useState<ToolApprovalRemember>(() =>
    options.includes("once") ? "once" : options[0],
  );
  const [submitting, setSubmitting] = useState<ToolApprovalDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const args = formatArgs(prompt.args);

  const respond = async (decision: ToolApprovalDecision) => {
    setSubmitting(decision);
    setError(null);
    try {
      await streamsApi.respondToToolApproval(prompt.request_id, decision, remember);
      clearPendingToolApproval(streamKey, prompt.request_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send your decision.");
      setSubmitting(null);
    }
  };

  return (
    <section className={styles.card} aria-label="Agent action approval">
      <div className={styles.headingRow}>
        <span className={styles.icon} aria-hidden="true">
          <ShieldAlert size={18} />
        </span>
        <div className={styles.copy}>
          <strong>Approval needed</strong>
          <span>
            This agent wants to run <b>{displayToolName(prompt.tool_name)}</b> in its environment.
          </span>
        </div>
      </div>

      {args ? (
        <details className={styles.details}>
          <summary>Review request</summary>
          <pre>{args}</pre>
        </details>
      ) : null}

      <div className={styles.controls}>
        {options.length > 1 ? (
          <label className={styles.rememberLabel}>
            Remember
            <select
              value={remember}
              disabled={submitting !== null}
              onChange={(event) => setRemember(event.target.value as ToolApprovalRemember)}
            >
              {options.map((option) => (
                <option key={option} value={option}>{REMEMBER_LABELS[option]}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className={styles.onceLabel}>This decision applies once</span>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.denyButton}
            disabled={submitting !== null}
            onClick={() => void respond("off")}
          >
            {submitting === "off" ? "Denying…" : "Deny"}
          </button>
          <button
            type="button"
            className={styles.allowButton}
            disabled={submitting !== null}
            onClick={() => void respond("on")}
          >
            {submitting === "on" ? "Allowing…" : "Allow"}
          </button>
        </div>
      </div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
