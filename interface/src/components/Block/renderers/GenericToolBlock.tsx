import { Wrench } from "lucide-react";
import type { ToolCallEntry } from "../../../shared/types/stream";
import { TOOL_LABELS } from "../../../constants/tools";
import {
  formatResult,
  formatRetryDelay,
  parseToolError,
  summarizeInput,
  summarizeError,
  type ToolErrorPresentation,
} from "../../../shared/utils/format";
import {
  blockStatusForSeverity,
  deriveToolSeverity,
} from "../../../utils/tool-severity";
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

function ToolErrorResponse({ error }: { error: ToolErrorPresentation }) {
  const metadata = [
    error.status != null ? `HTTP ${error.status}` : null,
    error.code,
  ].filter((value): value is string => value != null);

  return (
    <section className={styles.toolErrorResponse} aria-label="Tool error response">
      <div className={styles.toolErrorTitle}>{error.title}</div>
      <div className={styles.toolErrorMessage}>{error.message}</div>
      {error.retryAfterSeconds != null ? (
        <div className={styles.toolErrorRetry}>
          Try again in {formatRetryDelay(error.retryAfterSeconds)}.
        </div>
      ) : null}
      {error.guidance.length > 0 ? (
        <ul className={styles.toolErrorGuidance}>
          {error.guidance.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : null}
      {metadata.length > 0 ? (
        <div className={styles.toolErrorMeta}>{metadata.join(" · ")}</div>
      ) : null}
    </section>
  );
}

export function GenericToolBlock({ entry, defaultExpanded }: GenericToolBlockProps) {
  const label = TOOL_LABELS[entry.name] || entry.name;
  const summary = summarizeInput(entry.name, entry.input);
  const severity = deriveToolSeverity(entry);
  const status = blockStatusForSeverity(severity);
  const errorPresentation = entry.isError && entry.result
    ? parseToolError(entry.result)
    : null;

  const headerSummary =
    entry.isError && entry.result
      ? summarizeError(entry.result)
      : summary || (entry.pending ? "Generating…" : "");

  const getCopyText = (): string =>
    JSON.stringify(
      {
        tool: entry.name,
        input: buildInputDisplay(entry),
        result: entry.result ?? null,
      },
      null,
      2,
    );

  const inputSection = (
    <div className={styles.genericSection}>
      <div className={styles.genericLabel}>Input</div>
      <div className={styles.genericJson}>
        {JSON.stringify(buildInputDisplay(entry), null, 2)}
      </div>
    </div>
  );

  const resultSection = entry.pending ? (
    <div className={styles.genericSection}>
      <div className={styles.genericLabel}>Status</div>
      <div className={styles.genericJson}>Waiting for the tool result.</div>
    </div>
  ) : entry.result != null ? (
    <div className={styles.genericSection}>
      <div className={styles.genericLabel}>{entry.isError ? "Error" : "Result"}</div>
      {errorPresentation ? (
        <ToolErrorResponse error={errorPresentation} />
      ) : (
        <div
          className={`${styles.genericJson} ${
            severity === "error"
              ? styles.genericError
              : entry.isError
                ? styles.genericNote
                : ""
          }`}
        >
          {formatResult(entry.result)}
        </div>
      )}
    </div>
  ) : null;

  return (
    <Block
      icon={<Wrench size={12} />}
      title={label}
      summary={headerSummary || undefined}
      status={status}
      defaultExpanded={defaultExpanded ?? false}
      flushBody
      copy={{ getText: getCopyText, ariaLabel: `Copy ${label}` }}
    >
      {entry.isError ? resultSection : inputSection}
      {entry.isError ? inputSection : resultSection}
    </Block>
  );
}
