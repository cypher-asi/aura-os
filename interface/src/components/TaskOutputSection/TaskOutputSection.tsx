import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { GroupCollapsible } from "@cypher-asi/zui";
import { ClipboardCopy, Check, Loader2 } from "lucide-react";
import { MessageBubble } from "../MessageBubble";
import { StreamingBubble } from "../StreamingBubble";
import {
  useStreamEvents,
  useIsStreaming,
  useIsWriting,
  useStreamingText,
  useThinkingText,
  useThinkingDurationMs,
  useActiveToolCalls,
  useTimeline,
  useProgressText,
} from "../../hooks/stream/hooks";
import type { TaskOutputEntry } from "../../stores/event-store/index";
import { useTaskOutput } from "../../stores/event-store/index";
import { useTaskOutputView } from "../../hooks/use-task-output-view";
import { useProjectActions } from "../../stores/project-action-store";
import { useCooldownStatus, cooldownLabel } from "../../hooks/use-cooldown-status";
import { getStreamingPhaseLabel } from "../../utils/streaming";
import type { DisplaySessionEvent, ToolCallEntry } from "../../types/stream";
import type { Task } from "../../types";
import { CookingIndicator } from "../CookingIndicator";
import styles from "../Preview/Preview.module.css";

/* ------------------------------------------------------------------ */
/*  Debug output serializer                                            */
/* ------------------------------------------------------------------ */

interface DebugContext {
  task: Task;
  events: DisplaySessionEvent[];
  streamingText: string;
  thinkingText: string;
  fallbackText: string;
  activeToolCalls: ToolCallEntry[];
  taskOutput: TaskOutputEntry;
  failReason: string | null;
}

function formatToolCall(tc: ToolCallEntry): string {
  const parts = [`  - ${tc.name}`];
  const inputKeys = Object.keys(tc.input);
  if (inputKeys.length > 0) {
    const summary = inputKeys
      .map((k) => {
        const v = tc.input[k];
        const s = typeof v === "string" ? v : JSON.stringify(v);
        return `${k}: ${s.length > 120 ? s.slice(0, 120) + "..." : s}`;
      })
      .join(", ");
    parts.push(`    input: { ${summary} }`);
  }
  if (tc.result) parts.push(`    result: ${tc.result.length > 300 ? tc.result.slice(0, 300) + "..." : tc.result}`);
  if (tc.isError) parts.push("    [ERROR]");
  if (tc.pending) parts.push("    [pending]");
  return parts.join("\n");
}

function formatDebugOutput(ctx: DebugContext): string {
  const lines: string[] = [];

  lines.push(`# Task: ${ctx.task.title}`);
  lines.push(`ID: ${ctx.task.task_id}`);
  lines.push(`Status: ${ctx.task.status}`);
  if (ctx.task.model) lines.push(`Model: ${ctx.task.model}`);
  if (ctx.task.total_input_tokens || ctx.task.total_output_tokens)
    lines.push(`Tokens: ${ctx.task.total_input_tokens} in / ${ctx.task.total_output_tokens} out`);
  lines.push("");

  if (ctx.failReason) {
    lines.push("## Fail Reason");
    lines.push(ctx.failReason);
    lines.push("");
  }

  const agentText = [
    ...ctx.events.map((e) => e.content).filter(Boolean),
    ctx.streamingText,
    ctx.fallbackText,
  ]
    .filter(Boolean)
    .join("\n\n");
  if (agentText) {
    lines.push("## Agent Output");
    lines.push(agentText);
    lines.push("");
  }

  if (ctx.thinkingText) {
    lines.push("## Thinking");
    lines.push(ctx.thinkingText);
    lines.push("");
  }

  const allToolCalls = [
    ...ctx.events.flatMap((e) => e.toolCalls ?? []),
    ...ctx.activeToolCalls,
  ];
  if (allToolCalls.length > 0) {
    lines.push("## Tool Calls");
    lines.push(allToolCalls.map(formatToolCall).join("\n"));
    lines.push("");
  }

  if (ctx.taskOutput.buildSteps.length > 0) {
    lines.push("## Build Verification");
    for (const s of ctx.taskOutput.buildSteps) {
      lines.push(`  [${s.kind}]${s.command ? ` $ ${s.command}` : ""}${s.attempt != null ? ` (attempt ${s.attempt})` : ""}`);
      if (s.reason) lines.push(`    reason: ${s.reason}`);
      if (s.stdout) lines.push(`    stdout: ${s.stdout}`);
      if (s.stderr) lines.push(`    stderr: ${s.stderr}`);
    }
    lines.push("");
  }

  if (ctx.taskOutput.testSteps.length > 0) {
    lines.push("## Test Verification");
    for (const s of ctx.taskOutput.testSteps) {
      lines.push(`  [${s.kind}]${s.command ? ` $ ${s.command}` : ""}${s.attempt != null ? ` (attempt ${s.attempt})` : ""}`);
      if (s.summary) lines.push(`    summary: ${s.summary}`);
      if (s.stdout) lines.push(`    stdout: ${s.stdout}`);
      if (s.stderr) lines.push(`    stderr: ${s.stderr}`);
      for (const t of s.tests) {
        lines.push(`    ${t.status === "passed" ? "PASS" : "FAIL"} ${t.name}${t.message ? `: ${t.message}` : ""}`);
      }
    }
    lines.push("");
  }

  const fileOps = ctx.taskOutput.fileOps.length > 0 ? ctx.taskOutput.fileOps : ctx.task.files_changed ?? [];
  if (fileOps.length > 0) {
    lines.push("## Files Changed");
    for (const f of fileOps) {
      lines.push(`  ${f.op} ${f.path}`);
    }
    lines.push("");
  }

  if (ctx.task.execution_notes) {
    lines.push("## Execution Notes");
    lines.push(ctx.task.execution_notes);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Render the status line shown in place of "Waiting for agent output…"
 * when the loop is paused for a provider cooldown. Exported so the
 * component test can assert on the exact wording without reaching into
 * JSX internals.
 */
export function renderCooldownMessage(cooldown: {
  retryKind: string | null;
  remainingSeconds: number | null;
}): string {
  const label = cooldownLabel(cooldown.retryKind);
  if (cooldown.remainingSeconds != null && cooldown.remainingSeconds > 0) {
    return `${label} — resuming in ${cooldown.remainingSeconds}s…`;
  }
  return `${label} — resuming…`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export interface TaskOutputSectionProps {
  isActive: boolean;
  streamKey: string;
  taskId?: string;
  task?: Task;
  taskOutput?: TaskOutputEntry;
  failReason?: string | null;
  scrollRef?: RefObject<HTMLDivElement | null>;
  isAutoFollowing?: boolean;
}

export function TaskOutputSection({
  isActive,
  streamKey,
  taskId,
  task,
  taskOutput: externalTaskOutput,
  failReason,
  scrollRef,
  isAutoFollowing = true,
}: TaskOutputSectionProps) {
  const events = useStreamEvents(streamKey);
  const isStreaming = useIsStreaming(streamKey);
  const isWriting = useIsWriting(streamKey);
  const streamingText = useStreamingText(streamKey);
  const thinkingText = useThinkingText(streamKey);
  const thinkingDurationMs = useThinkingDurationMs(streamKey);
  const activeToolCalls = useActiveToolCalls(streamKey);
  const timeline = useTimeline(streamKey);
  const progressText = useProgressText(streamKey);
  const [copied, setCopied] = useState(false);

  // Seed structured turns from the persistent cache for terminal
  // rows where the live stream-store entry was pruned. The hook's
  // seeding writes into the stream store, so `useStreamEvents`
  // above picks up the rehydrated events reactively on the next
  // render without any additional wiring here.
  const ctx = useProjectActions();
  useTaskOutputView(taskId, ctx?.project.project_id, !isActive);
  const cooldown = useCooldownStatus(undefined, ctx?.project.project_id);

  const hydratedOutput = useTaskOutput(taskId);
  const fallbackText = hydratedOutput.text;
  const taskOutput = externalTaskOutput ?? hydratedOutput;

  const hasLiveContent =
    !!streamingText || !!thinkingText || !!progressText || activeToolCalls.length > 0;
  const hasStreamContent = events.length > 0 || hasLiveContent;
  const hasFallback = !hasStreamContent && !!fallbackText;
  const hasContent = hasStreamContent || hasFallback;
  const streamingPhaseLabel =
    isActive && hasLiveContent
      ? getStreamingPhaseLabel({
          streamingText,
          thinkingText,
          toolCalls: activeToolCalls,
          progressText,
          isWriting,
        })
      : null;

  // Pin the parent scroll container to the bottom when the tail of the
  // stream grows. CSS `overflow-anchor: auto` on the scroll container
  // handles growth above the anchor natively; this effect covers growth
  // at the anchor by writing scrollTop synchronously during commit, before
  // the browser paints the intermediate "pushed up" state. Mirrors the
  // main chat's pattern in ChatMessageList.
  useLayoutEffect(() => {
    if (!scrollRef || !isActive || !isAutoFollowing || !hasLiveContent) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [
    scrollRef,
    isActive,
    isAutoFollowing,
    hasLiveContent,
    streamingText,
    thinkingText,
    activeToolCalls.length,
    progressText,
    timeline.length,
    events.length,
  ]);

  const handleCopy = useCallback(() => {
    if (!task) return;
    const text = formatDebugOutput({
      task,
      events,
      streamingText,
      thinkingText,
      fallbackText,
      activeToolCalls,
      taskOutput,
      failReason: failReason ?? null,
    });
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [task, events, streamingText, thinkingText, fallbackText, activeToolCalls, taskOutput, failReason]);

  if (!hasContent && !isActive) return null;

  const copyButton = task && hasContent ? (
    <button
      type="button"
      className={styles.copyOutputButton}
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      title={copied ? "Copied!" : "Copy all output"}
      aria-label="Copy all output"
    >
      {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
    </button>
  ) : null;

  return (
    <GroupCollapsible
      label={isActive ? "Live Output" : "Output"}
      defaultOpen
      className={styles.section}
      stats={copyButton}
    >
      <div className={styles.liveOutputSection}>
        {isActive && !hasContent && (
          <div className={styles.activityItem}>
            <span className={styles.activityIcon}>
              <Loader2 size={12} className={styles.spinner} />
            </span>
            <span className={styles.activityBody}>
              <span className={styles.activityMessage} style={{ opacity: 0.5 }}>
                {cooldown.paused
                  ? renderCooldownMessage(cooldown)
                  : "Waiting for agent output…"}
              </span>
            </span>
          </div>
        )}
        {hasFallback && (
          <MessageBubble
            key="hydrated-output"
            message={{ id: "hydrated-output", role: "assistant", content: fallbackText }}
          />
        )}
        {events.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={isStreaming && msg.id.startsWith("stream-")}
          />
        ))}
        {hasLiveContent && (
          <StreamingBubble
            isStreaming={isStreaming}
            text={streamingText}
            toolCalls={activeToolCalls}
            thinkingText={thinkingText}
            thinkingDurationMs={thinkingDurationMs}
            timeline={timeline}
            progressText={progressText}
            isWriting={isWriting}
            showPhaseIndicator={false}
          />
        )}
        {streamingPhaseLabel && (
          <div className={styles.previewStreamingIndicator} aria-live="polite">
            <CookingIndicator label={streamingPhaseLabel} />
          </div>
        )}
      </div>
    </GroupCollapsible>
  );
}
