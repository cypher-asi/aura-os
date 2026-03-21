import { useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Button, Text, GroupCollapsible, Item } from "@cypher-asi/zui";
import { X, ArrowLeft, FileText } from "lucide-react";
import { useSidekick } from "../../stores/sidekick-store";
import { useProjectContext } from "../../stores/project-action-store";
import { TaskPreview } from "../TaskPreview";
import { RunTaskButton } from "../RunTaskButton";
import { SessionPreview } from "../SessionPreview";
import { LogPreview } from "../LogPreview";
import { formatRelativeTime } from "../../utils/format";
import type { PreviewItem } from "../../stores/sidekick-store";
import type { Spec } from "../../types";
import styles from "./Preview.module.css";

function SpecsOverviewPreview({ specs }: { specs: Spec[] }) {
  const sidekick = useSidekick();
  const ctx = useProjectContext();
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
          <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {summaryText ? (
                <Text variant="secondary" size="sm" style={{ whiteSpace: "pre-wrap" }} className={styles.specSummaryParagraph}>
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
                onClick={() => sidekick.pushPreview({ kind: "spec", spec })}
                className={styles.fileOpItem}
              >
                <Item.Icon><FileText size={14} /></Item.Icon>
                <Item.Label title={spec.title}>{spec.title}</Item.Label>
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
  const { previewItem } = useSidekick();
  return previewItem;
}

export function PreviewHeader() {
  const { closePreview, canGoBack, goBackPreview } = useSidekick();
  const displayItem = useDisplayItem();
  const ctx = useProjectContext();

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
          onClick={goBackPreview}
        />
      )}
      <Text size="sm" className={styles.previewTitle} style={{ fontWeight: 600 }}>
        {title}
      </Text>
      {displayItem.kind === "task" && <RunTaskButton task={displayItem.task} />}
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        icon={<X size={14} />}
        aria-label="Close"
        onClick={closePreview}
      />
    </div>
  );
}

export function PreviewContent() {
  const displayItem = useDisplayItem();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const autoScrollRef = useRef(true);

  const resetKey = displayItem
    ? displayItem.kind === "task" ? displayItem.task.task_id
    : displayItem.kind === "spec" ? displayItem.spec.spec_id
    : displayItem.kind === "specs_overview" ? "__specs_root__"
    : displayItem.kind === "session" ? displayItem.session.session_id
    : displayItem.kind === "log" ? `${displayItem.entry.timestamp}_${displayItem.entry.type}`
    : null
    : null;

  useEffect(() => {
    autoScrollRef.current = true;
  }, [resetKey]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const scrollIfNeeded = () => {
      if (autoScrollRef.current) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    };

    const onScroll = () => {
      const { scrollHeight, scrollTop, clientHeight } = el;
      autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
    };

    el.addEventListener("scroll", onScroll, { passive: true });

    const observer = new MutationObserver(scrollIfNeeded);
    observer.observe(el, { childList: true, subtree: true, characterData: true });

    scrollIfNeeded();

    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [resetKey]);

  return (
    <div ref={bodyRef} className={styles.previewBody}>
      {displayItem?.kind === "spec" && <SpecPreview spec={displayItem.spec} />}
      {displayItem?.kind === "specs_overview" && <SpecsOverviewPreview specs={displayItem.specs} />}
      {displayItem?.kind === "task" && <TaskPreview task={displayItem.task} />}
      {displayItem?.kind === "session" && <SessionPreview session={displayItem.session} />}
      {displayItem?.kind === "log" && <LogPreview entry={displayItem.entry} />}
    </div>
  );
}
