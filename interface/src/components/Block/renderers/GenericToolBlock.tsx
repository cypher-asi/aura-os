import { Wrench } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { TOOL_LABELS } from "../../../constants/tools";
import { formatResult, summarizeInput, summarizeError } from "../../../shared/utils/format";
import { Block } from "../Block";
import styles from "./renderers.module.css";

function buildInputDisplay(entry: ToolCallEntry): Record<string, unknown> {
  const explicitInput = entry.input ?? {};
  const hasExplicitKeys = Object.keys(explicitInput).length > 0;

  return {
    explicitInput,
    resolvedInput: explicitInput,
    resolvedContext: {
      toolCallId: entry.id,
      toolName: entry.name,
      resolution: hasExplicitKeys ? "explicit_only" : "implicit_defaults_possible",
    },
    ...(hasExplicitKeys
      ? {}
      : {
          notes: [
            "No explicit arguments were provided by the model.",
            "Runtime defaults and ambient context may still have been applied.",
          ],
        }),
  };
}

interface GenericToolBlockProps {
  entry: ToolCallEntry;
  defaultExpanded?: boolean;
}

export function GenericToolBlock({ entry, defaultExpanded }: GenericToolBlockProps) {
  const label = TOOL_LABELS[entry.name] || entry.name;
  const summary = summarizeInput(entry.name, entry.input);
  const status = entry.pending ? "pending" : entry.isError ? "error" : "done";

  const headerSummary =
    entry.isError && entry.result
      ? summarizeError(entry.result)
      : summary || (entry.pending ? "Generating…" : "");

  return (
    <Block
      icon={<Wrench size={12} />}
      title={label}
      summary={headerSummary || undefined}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
    >
      <div className={styles.genericSection}>
        <div className={styles.genericLabel}>Input</div>
        <div className={styles.genericJson}>
          {JSON.stringify(buildInputDisplay(entry), null, 2)}
        </div>
      </div>
      {entry.pending ? (
        <div className={styles.genericSection}>
          <div className={styles.genericLabel}>Status</div>
          <div className={styles.genericJson}>Waiting for the tool result.</div>
        </div>
      ) : entry.result != null ? (
        <div className={styles.genericSection}>
          <div className={styles.genericLabel}>{entry.isError ? "Error" : "Result"}</div>
          <div
            className={`${styles.genericJson} ${entry.isError ? styles.genericError : ""}`}
          >
            {formatResult(entry.result)}
          </div>
        </div>
      ) : null}
    </Block>
  );
}
