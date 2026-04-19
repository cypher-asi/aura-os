import { useRef, useEffect } from "react";
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
import { formatRelativeTime } from "../../utils/format";
import type { PreviewItem } from "../../stores/sidekick-store";
import type { Spec } from "../../types";
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

function isUserInteractingWithPreview(el: HTMLElement): boolean {
  const activeElement = document.activeElement;
  return (
    activeElement instanceof HTMLElement &&
    activeElement !== el &&
    el.contains(activeElement)
  );
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

export function PreviewContent() {
  const displayItem = useDisplayItem();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);
  const prevScrollHeightRef = useRef(0);

  const resetKey = displayItem
    ? displayItem.kind === "task" ? displayItem.task.task_id
    : displayItem.kind === "spec" ? displayItem.spec.spec_id
    : displayItem.kind === "specs_overview" ? "__specs_root__"
    : displayItem.kind === "session" ? displayItem.session.session_id
    : displayItem.kind === "log" ? `${displayItem.entry.timestamp}_${displayItem.entry.type}`
    : null
    : null;

  const shouldAutoScroll = displayItem?.kind === "task";

  useEffect(() => {
    autoScrollRef.current = shouldAutoScroll;
    prevScrollHeightRef.current = 0;
  }, [resetKey, shouldAutoScroll]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    if (!shouldAutoScroll) {
      el.scrollTop = 0;
      prevScrollHeightRef.current = el.scrollHeight;
      return;
    }

    let contentChangeRaf = 0;

    const scrollToBottom = () => {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    };

    const syncHeight = () => {
      prevScrollHeightRef.current = el.scrollHeight;
    };

    const onContentChange = () => {
      const oldSH = prevScrollHeightRef.current;
      const newSH = el.scrollHeight;
      if (newSH === oldSH) return;

      if (isUserInteractingWithPreview(el)) {
        autoScrollRef.current = false;
      } else if (autoScrollRef.current && newSH > oldSH) {
        scrollToBottom();
      }

      syncHeight();
    };

    const queueContentChange = () => {
      if (contentChangeRaf !== 0) return;
      contentChangeRaf = requestAnimationFrame(() => {
        contentChangeRaf = 0;
        onContentChange();
      });
    };

    const onScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = el;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    const contentObs =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(queueContentChange);
    const observedChildren = new Set<Element>();
    const syncObservedChildren = () => {
      if (!contentObs) return;
      const children = new Set(Array.from(el.children));
      for (const child of observedChildren) {
        if (!children.has(child)) {
          contentObs.unobserve(child);
          observedChildren.delete(child);
        }
      }
      for (const child of children) {
        if (!observedChildren.has(child)) {
          observedChildren.add(child);
          contentObs.observe(child);
        }
      }
    };

    const observer = new MutationObserver(() => {
      syncObservedChildren();
      queueContentChange();
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    syncObservedChildren();
    scrollToBottom();
    syncHeight();

    return () => {
      if (contentChangeRaf !== 0) {
        cancelAnimationFrame(contentChangeRaf);
      }
      observer.disconnect();
      contentObs?.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [resetKey, shouldAutoScroll]);

  return (
    <div ref={bodyRef} className={styles.previewBody} data-testid="preview-body">
      {displayItem?.kind === "spec" && <SpecPreview spec={displayItem.spec} />}
      {displayItem?.kind === "specs_overview" && <SpecsOverviewPreview specs={displayItem.specs} />}
      {displayItem?.kind === "task" && <TaskPreview task={displayItem.task} />}
      {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
      {displayItem?.kind === "log" && <LogPreview entry={displayItem.entry} />}
    </div>
  );
}
