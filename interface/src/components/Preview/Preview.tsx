import { useRef, useCallback, useLayoutEffect, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text, GroupCollapsible } from "@cypher-asi/zui";
import { X, ArrowLeft, FileText } from "lucide-react";
import { ListItem } from "../ListItem";
import { useParams } from "react-router-dom";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { api } from "../../api/client";
import { usePlanStore } from "../../stores/plan-store";
import { getLastAgent } from "../../utils/storage";
import { TaskPreview } from "../TaskPreview";
import { TaskHeaderContextUsage } from "../TaskOutputPanel/TaskHeaderContextUsage";
import { RunTaskButton } from "../RunTaskButton";
import { SessionPreview } from "../SessionPreview";
import { LogPreview } from "../LogPreview";
import { ContextBucketPreview, contextBucketLabel } from "../ContextBucketPreview";
import { formatRelativeTime } from "../../shared/utils/format";
import type { PreviewItem } from "../../stores/sidekick-store";
import type { Spec } from "../../shared/types";
import styles from "./Preview.module.css";

const attemptedSummaryKeys = new Set<string>();

function SpecsOverviewPreview({
  specs,
  summary,
  planId,
}: {
  specs: Spec[];
  summary?: string;
  planId?: string;
}) {
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const updatePreviewSummary = useSidekickStore((s) => s.updatePreviewSummary);
  const ctx = useProjectActions();
  const project = ctx?.project;
  const projectId = project?.project_id;
  // The /specs/summary endpoint resolves its model from the agent
  // instance, so we must forward one (route param first, then the
  // project's last-used agent). Without it the harness rejects the turn
  // with "model name must not be empty".
  const routeAgentInstanceId = useParams<{ agentInstanceId?: string }>().agentInstanceId;

  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const summaryText = summary ?? project?.specs_summary ?? null;

  const runGenerate = useCallback(() => {
    if (!projectId || generating) return;
    const agentInstanceId =
      routeAgentInstanceId ?? getLastAgent(projectId) ?? undefined;
    setGenerating(true);
    setGenError(null);
    api
      .generateSpecsSummary(projectId, agentInstanceId)
      .then((updated) => {
        const next = updated?.specs_summary ?? "";
        if (next) {
          ctx?.setProject((p) => ({ ...p, specs_summary: next }));
          if (planId) usePlanStore.getState().setPlanSummary(projectId, planId, next);
          updatePreviewSummary(next);
        }
      })
      .catch((e) =>
        setGenError(e instanceof Error ? e.message : "Failed to generate summary"),
      )
      .finally(() => setGenerating(false));
  }, [projectId, planId, generating, ctx, updatePreviewSummary, routeAgentInstanceId]);

  // Auto-generate once per (project, plan) when there is no summary yet.
  useEffect(() => {
    if (summaryText || !projectId || specs.length === 0) return;
    const key = `${projectId}:${planId ?? "default"}`;
    if (attemptedSummaryKeys.has(key)) return;
    attemptedSummaryKeys.add(key);
    // Drives an async summary-generation request (external system), not
    // derived render state; the setState inside runGenerate gates loading UI.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runGenerate();
  }, [summaryText, projectId, planId, specs.length, runGenerate]);

  const firstCreated = specs.length > 0
    ? specs.reduce((a, s) => (s.created_at < a ? s.created_at : a), specs[0].created_at)
    : null;
  const lastUpdated = specs.length > 0
    ? specs.reduce((a, s) => (s.updated_at > a ? s.updated_at : a), specs[0].updated_at)
    : null;

  return (
    <>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <div className={styles.summaryHeader}>
            <span className={styles.fieldLabel}>Summary</span>
            {!generating && (
              <Button variant="ghost" size="sm" onClick={runGenerate}>
                {summaryText ? "Regenerate" : "Generate summary"}
              </Button>
            )}
          </div>
          {generating ? (
            <Text variant="secondary" size="sm">Generating summary…</Text>
          ) : summaryText ? (
            <div className={`${styles.markdown} ${styles.summaryMarkdown}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {summaryText}
              </ReactMarkdown>
            </div>
          ) : (
            <Text variant="secondary" size="sm">No summary yet.</Text>
          )}
          {genError && (
            <Text variant="secondary" size="sm">{genError}</Text>
          )}
        </div>
        {firstCreated && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>First created</span>
            <Text variant="secondary" size="sm">{formatRelativeTime(firstCreated)}</Text>
          </div>
        )}
        {lastUpdated && (
          <div className={styles.taskField}>
            <span className={styles.fieldLabel}>Last updated</span>
            <Text variant="secondary" size="sm">{formatRelativeTime(lastUpdated)}</Text>
          </div>
        )}
      </div>

      <GroupCollapsible
        label="Specifications"
        count={specs.length}
        defaultOpen
        className={styles.section}
      >
        <div className={styles.fileOpsList}>
          {specs.map((spec) => (
            <ListItem
              key={spec.spec_id}
              icon={<FileText size={14} />}
              title={<span title={spec.title}>{spec.title}</span>}
              onSelect={() => pushPreview({ kind: "spec", spec })}
            />
          ))}
        </div>
      </GroupCollapsible>
    </>
  );
}

function SpecPreview({ spec }: { spec: Spec }) {
  return (
    <>
      <div className={styles.taskMeta}>
        <div className={styles.taskField}>
          <span className={styles.fieldLabel}>Title</span>
          <Text size="sm">{spec.title}</Text>
        </div>
      </div>
      <div className={`${styles.markdown} ${styles.specMarkdown}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {spec.markdown_contents}
        </ReactMarkdown>
      </div>
    </>
  );
}

function previewTitle(item: PreviewItem): string {
  switch (item.kind) {
    case "spec": return "Spec";
    case "specs_overview": return "Plan";
    case "task": return "Task";
    case "session": return `Session ${item.session.session_id.slice(0, 8)}`;
    case "log": return "Log";
    case "context_bucket": return contextBucketLabel(item.bucketId);
    default: { const _exhaustive: never = item; return _exhaustive; }
  }
}

function useDisplayItem() {
  return useSidekickStore((s) => s.previewItem);
}

export function PreviewHeader() {
  const closePreview = useSidekickStore((s) => s.closePreview);
  const canGoBack = useSidekickStore((s) => s.canGoBack);
  const goBackPreview = useSidekickStore((s) => s.goBackPreview);
  const displayItem = useDisplayItem();
  const ctx = useProjectActions();

  if (!displayItem) return null;

  const title =
    displayItem.kind === "specs_overview"
      ? (displayItem.title || ctx?.project?.specs_title || "Plan")
      : displayItem.kind === "spec"
        ? (displayItem.spec.title || "Spec")
        : previewTitle(displayItem);

  return (
    <div className={styles.previewHeader}>
      {canGoBack && displayItem.kind !== "specs_overview" && (
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={<ArrowLeft size={14} />}
          aria-label="Back"
          className={styles.previewHeaderButton}
          onClick={goBackPreview}
        />
      )}
      <Text size="sm" className={`${styles.previewTitle} ${styles.previewTitleBold}`}>
        {title}
      </Text>
      {displayItem.kind === "task" && <RunTaskButton task={displayItem.task} />}
      {displayItem.kind === "task" && (
        <TaskHeaderContextUsage
          taskId={displayItem.task.task_id}
          projectId={displayItem.task.project_id}
        />
      )}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<X size={14} />}
        aria-label="Close"
        className={styles.previewHeaderButton}
        onClick={closePreview}
      />
    </div>
  );
}

const FOLLOW_THRESHOLD_PX = 40;

export function PreviewContent() {
  const displayItem = useDisplayItem();
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const resetKey = displayItem
    ? displayItem.kind === "task" ? displayItem.task.task_id
    : displayItem.kind === "spec" ? displayItem.spec.spec_id
    : displayItem.kind === "specs_overview" ? "__specs_root__"
    : displayItem.kind === "session" ? displayItem.session.session_id
    : displayItem.kind === "log" ? `${displayItem.entry.timestamp}_${displayItem.entry.type}`
    : displayItem.kind === "context_bucket" ? `context_${displayItem.bucketId}_${displayItem.streamKey}`
    : null
    : null;

  const shouldAutoScroll = displayItem?.kind === "task";
  const [isAutoFollowing, setIsAutoFollowing] = useState(true);

  // On resetKey change, jump to the correct end of the body: bottom for a
  // task (where live output lands) and top for everything else. We run
  // this in a layout effect so the initial position is applied before the
  // browser paints — no visible scroll jump on preview switch. The
  // programmatic scrollTop assignment will dispatch a scroll event that
  // runs through handleScroll below, so pin state re-syncs from the new
  // position without a direct setState here.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = shouldAutoScroll ? el.scrollHeight : 0;
  }, [resetKey, shouldAutoScroll]);

  // Track pin/unpin while a task is showing. Tail-growth pinning (new
  // tokens, tool rows) is handled inside `ActiveTaskStream` via a
  // useLayoutEffect keyed on the stream store — pairs with CSS
  // `overflow-anchor: auto` on `.previewBody` which covers growth above
  // the anchor natively. Mirrors the main chat's pattern.
  const handleScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (!shouldAutoScroll) {
      setIsAutoFollowing((prev) => (prev ? prev : true));
      return;
    }
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const next = distFromBottom < FOLLOW_THRESHOLD_PX;
    setIsAutoFollowing((prev) => (prev === next ? prev : next));
  }, [shouldAutoScroll]);

  return (
    <div
      ref={bodyRef}
      className={styles.previewBody}
      data-testid="preview-body"
      onScroll={handleScroll}
    >
      {displayItem?.kind === "spec" && <SpecPreview spec={displayItem.spec} />}
      {displayItem?.kind === "specs_overview" && (
        <SpecsOverviewPreview specs={displayItem.specs} summary={displayItem.summary} planId={displayItem.planId} />
      )}
      {displayItem?.kind === "task" && (
        <TaskPreview
          task={displayItem.task}
          scrollRef={bodyRef}
          isAutoFollowing={isAutoFollowing}
        />
      )}
      {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
      {displayItem?.kind === "log" && <LogPreview entry={displayItem.entry} />}
      {displayItem?.kind === "context_bucket" && (
        <ContextBucketPreview
          bucketId={displayItem.bucketId}
          streamKey={displayItem.streamKey}
        />
      )}
    </div>
  );
}
