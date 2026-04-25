import { useRef, useCallback, useLayoutEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { X, ArrowLeft, FileText } from "lucide-react";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useProjectActions } from "../../stores/project-action-store";
import { TaskPreview } from "../TaskPreview";
import { RunTaskButton } from "../RunTaskButton";
import { SessionPreview } from "../SessionPreview";
import { LogPreview } from "../LogPreview";
import { formatRelativeTime } from "../../shared/utils/format";
import type { PreviewItem } from "../../stores/sidekick-store";
import type { Spec } from "../../shared/types";
import styles from "./Preview.module.css";

function SpecsOverviewPreview({ specs }: { specs: Spec[] }) {
  const pushPreview = useSidekickStore((s) => s.pushPreview);
  const ctx = useProjectActions();
  const project = ctx?.project;

  const summaryText = project?.specs_summary ?? null;

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
          <span className={styles.fieldLabel}>Summary</span>
          <div className={styles.summaryRow}>
            <div className={styles.summaryContent}>
              {summaryText ? (
                <Text variant="secondary" size="sm" className={`${styles.preWrapText} ${styles.specSummaryParagraph}`}>
                  {summaryText}
                </Text>
              ) : (
                <Text variant="secondary" size="sm">No specs yet.</Text>
              )}
            </div>
          </div>
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
              <Item
                key={spec.spec_id}
                onClick={() => pushPreview({ kind: "spec", spec })}
                className={styles.fileOpItem}
              >
                <Item.Icon><FileText size={14} /></Item.Icon>
                <Item.Label>
                  <span title={spec.title}>{spec.title}</span>
                </Item.Label>
              </Item>
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
    case "specs_overview": return "Specs";
    case "task": return "Task";
    case "session": return `Session ${item.session.session_id.slice(0, 8)}`;
    case "log": return "Log";
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
      ? (ctx?.project?.specs_title || "Specs")
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
  // tokens, tool rows) is handled inside `TaskOutputSection` via a
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
      {displayItem?.kind === "specs_overview" && <SpecsOverviewPreview specs={displayItem.specs} />}
      {displayItem?.kind === "task" && (
        <TaskPreview
          task={displayItem.task}
          scrollRef={bodyRef}
          isAutoFollowing={isAutoFollowing}
        />
      )}
      {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
      {displayItem?.kind === "log" && <LogPreview entry={displayItem.entry} />}
    </div>
  );
}
