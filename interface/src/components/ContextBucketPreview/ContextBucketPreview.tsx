import { useState, type ReactElement } from "react";
import { GroupCollapsible, Text } from "@cypher-asi/zui";
import { ListItem } from "../ListItem";
import type { ContextBucketId } from "../../stores/sidekick-store";
import { contextBucketLabel } from "./context-bucket-labels";
import { useContextBucketContents } from "./use-context-contents";
import styles from "./ContextBucketPreview.module.css";

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

/** The four buckets rendered as collapsible `ContextSegment` lists. */
type SegmentBucketId = "tools" | "skills" | "subagents" | "mcp";

function formatTokens(tokens: number): string {
  return `${TOKEN_FORMATTER.format(tokens)} tokens`;
}

interface ContextBucketPreviewProps {
  bucketId: ContextBucketId;
  streamKey: string;
}

/**
 * Presentational Sidekick preview of a single Context Composition
 * bucket. Reads the lazily-fetched contents for `streamKey` from the
 * cache (via {@link useContextBucketContents}) and renders the rendered
 * text the harness counted for that bucket: the system prompt as a
 * wrapped block, the tool/skill/subagent/MCP buckets as a collapsible
 * list of per-segment entries with token counts, and the conversation
 * bucket as an explanatory note (its content is the live transcript,
 * not round-tripped through the harness). Falls back to a friendly
 * empty state when no contents are available yet.
 */
export function ContextBucketPreview({
  bucketId,
  streamKey,
}: ContextBucketPreviewProps): ReactElement {
  const contents = useContextBucketContents(streamKey);
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const toggleSegment = (key: string): void => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // The live chat transcript is the conversation context, so there is
  // nothing extra to round-trip from the harness for this bucket.
  if (bucketId === "conversation") {
    return (
      <div className={styles.body}>
        <Text variant="secondary" size="sm" className={styles.note}>
          Conversation context is the live chat transcript shown in this
          thread. It isn't round-tripped through the harness, so there's
          nothing extra to display here.
        </Text>
      </div>
    );
  }

  if (!contents) {
    return (
      <div className={styles.body}>
        <Text variant="secondary" size="sm" className={styles.note}>
          Context details aren't available from this harness build yet.
        </Text>
      </div>
    );
  }

  if (bucketId === "system_prompt") {
    if (!contents.systemPrompt) {
      return (
        <div className={styles.body}>
          <Text variant="secondary" size="sm" className={styles.note}>
            Context details aren't available from this harness build yet.
          </Text>
        </div>
      );
    }
    return (
      <div className={styles.body}>
        <pre className={styles.systemPrompt}>{contents.systemPrompt}</pre>
      </div>
    );
  }

  const segmentBucketId: SegmentBucketId = bucketId;
  const segments = contents[segmentBucketId];
  const label = contextBucketLabel(segmentBucketId);

  if (segments.length === 0) {
    return (
      <div className={styles.body}>
        <Text variant="secondary" size="sm" className={styles.note}>
          No {label.toLowerCase()} in this context.
        </Text>
      </div>
    );
  }

  return (
    <div className={styles.body}>
      <GroupCollapsible
        label={label}
        count={segments.length}
        defaultOpen
        className={styles.section}
      >
        <div className={styles.segmentList}>
          {segments.map((segment, index) => {
            const key = `${segmentBucketId}:${index}`;
            const expanded = expandedKeys.has(key);
            return (
              <ListItem
                key={key}
                className={styles.segment}
                title={
                  <span title={segment.label}>
                    {segment.label || "(unnamed)"}
                  </span>
                }
                meta={
                  <span className={styles.tokenCount}>
                    {formatTokens(segment.tokens)}
                  </span>
                }
                hasChildren
                expanded={expanded}
                onExpandedChange={() => toggleSegment(key)}
                onSelect={() => toggleSegment(key)}
              >
                <pre className={styles.segmentText}>{segment.text}</pre>
              </ListItem>
            );
          })}
        </div>
      </GroupCollapsible>
    </div>
  );
}
