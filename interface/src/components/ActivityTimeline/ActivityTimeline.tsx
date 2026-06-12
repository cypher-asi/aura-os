import { memo, useMemo, useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";
import { FILE_OPS } from "../../constants/tools";
import {
  stripEmojis,
  normalizeMidSentenceBreaks,
  flattenListIndentation,
  normalizeLooseStrongEmphasis,
} from "../../shared/utils/text-normalize";
import { ThinkingBlock, isAutoExpandedTool, renderToolBlock } from "../Block";
import { SegmentedContent } from "../SegmentedContent";
import { useScrollMargin } from "../../shared/hooks/use-scroll-margin";
import { canonicalInputKey, computeUniquePathTails } from "./grouping";
import styles from "./ActivityTimeline.module.css";

interface ActivityTimelineProps {
  timeline: TimelineItem[];
  thinkingText?: string;
  thinkingDurationMs?: number | null;
  toolCalls?: ToolCallEntry[];
  isStreaming: boolean;
  defaultThinkingExpanded?: boolean;
  defaultActivitiesExpanded?: boolean;
  /**
   * When provided, the timeline windows its rows via `@tanstack/react-virtual`,
   * using `scrollRef` as the scroll element. Mirrors the approach used by
   * `CompletedTaskOutput` so the task preview overlay stays fast on large
   * tool-heavy runs. When absent (chat surfaces, isolated tests) the
   * component falls back to a plain non-virtualized render.
   */
  scrollRef?: RefObject<HTMLElement | null>;
}

type ToolPosition = "first" | "mid" | "last" | "solo" | null;

/**
 * Plain-data row model. Rows carry primitives / stable references
 * (never pre-built JSX) so the `TimelineRow` memo below can actually
 * bail on unchanged rows. The previous design memoized on a `node`
 * ReactNode prop, but the node elements were recreated on every parent
 * render, so the memo never bailed and every streaming tick re-ran
 * ReactMarkdown + syntax highlighting for the entire timeline.
 */
type RenderedItem =
  | {
      key: string;
      kind: "thinking";
      toolPosition: ToolPosition;
      text: string;
      isStreaming: boolean;
      durationMs: number | null | undefined;
      defaultExpanded: boolean | undefined;
    }
  | {
      key: string;
      kind: "tool";
      toolPosition: ToolPosition;
      entry: ToolCallEntry;
      defaultExpanded: boolean;
      displayPath: string | undefined;
      groupCount: number | undefined;
    }
  | {
      key: string;
      kind: "text";
      toolPosition: ToolPosition;
      content: string;
      isStreaming: boolean;
    };

function areRowsEqual(
  prev: { item: RenderedItem },
  next: { item: RenderedItem },
): boolean {
  const a = prev.item;
  const b = next.item;
  if (a.kind !== b.kind || a.key !== b.key) return false;
  if (a.kind === "thinking" && b.kind === "thinking") {
    return (
      a.text === b.text &&
      a.isStreaming === b.isStreaming &&
      a.durationMs === b.durationMs &&
      a.defaultExpanded === b.defaultExpanded
    );
  }
  if (a.kind === "tool" && b.kind === "tool") {
    // Tool entries are replaced immutably by the stream handlers, so
    // reference equality is a correct change signal.
    return (
      a.entry === b.entry &&
      a.defaultExpanded === b.defaultExpanded &&
      a.displayPath === b.displayPath &&
      a.groupCount === b.groupCount
    );
  }
  if (a.kind === "text" && b.kind === "text") {
    return a.content === b.content && a.isStreaming === b.isStreaming;
  }
  return false;
}

/**
 * Per-row renderer. During a live stream only the trailing row's data
 * changes frame-to-frame, so every settled row bails here and skips
 * its ThinkingBlock / tool Block / markdown render entirely. The text
 * normalization pipeline also lives inside the memo boundary so frozen
 * rows don't re-run it either.
 */
const TimelineRow = memo(function TimelineRow({ item }: { item: RenderedItem }) {
  if (item.kind === "thinking") {
    return (
      <ThinkingBlock
        text={item.text}
        isStreaming={item.isStreaming}
        durationMs={item.durationMs}
        defaultExpanded={item.defaultExpanded}
      />
    );
  }
  if (item.kind === "tool") {
    return (
      <>
        {renderToolBlock(item.entry, item.defaultExpanded, {
          displayPath: item.displayPath,
          groupCount: item.groupCount,
        })}
      </>
    );
  }
  const normalized = normalizeLooseStrongEmphasis(
    flattenListIndentation(normalizeMidSentenceBreaks(stripEmojis(item.content))),
  );
  return <SegmentedContent content={normalized} isStreaming={item.isStreaming} />;
}, areRowsEqual);

export function ActivityTimeline({
  timeline,
  thinkingText,
  thinkingDurationMs,
  toolCalls,
  isStreaming,
  defaultThinkingExpanded,
  defaultActivitiesExpanded,
  scrollRef,
}: ActivityTimelineProps) {
  const toolCallMap = useMemo(() => {
    const map = new Map<string, ToolCallEntry>();
    if (toolCalls) {
      for (const tc of toolCalls) map.set(tc.id, tc);
    }
    return map;
  }, [toolCalls]);

  // Consolidate contiguous `thinking` timeline entries into a single rendered
  // ThinkingBlock to avoid duplicate blocks when the stream briefly toggles
  // between thinking states. We walk the timeline twice: first to build a
  // merged list, then to apply the per-kind render rules below.
  const mergedTimeline: TimelineItem[] = [];
  for (const item of timeline) {
    const prev = mergedTimeline[mergedTimeline.length - 1];
    if (
      item.kind === "thinking" &&
      prev &&
      prev.kind === "thinking"
    ) {
      const mergedText = (prev.text ?? "") + (item.text ?? "");
      // Sum the per-segment durations when merging contiguous
      // thinking items so the combined block reflects the full
      // wall-clock spent thinking across both, not just one.
      const mergedDuration =
        prev.durationMs != null || item.durationMs != null
          ? (prev.durationMs ?? 0) + (item.durationMs ?? 0)
          : undefined;
      // Keep the earlier `startMs` so a still-open segment merge
      // (rare, but possible if both have `startMs` and no
      // `durationMs`) continues to measure from the original start.
      const mergedStart =
        prev.startMs != null
          ? prev.startMs
          : item.startMs;
      mergedTimeline[mergedTimeline.length - 1] = {
        ...prev,
        text: mergedText || undefined,
        startMs: mergedStart,
        durationMs: mergedDuration,
      };
      continue;
    }
    mergedTimeline.push(item);
  }

  // When the model emits zero `thinking_delta` blocks on the wire
  // (Opus-4 Adaptive default, plus any other path where the API
  // chooses not to surface reasoning) the user otherwise sees tool
  // blocks appear with no narration above them. Render a single
  // synthetic Brain "Thinking..." block as a stable sibling above
  // the timeline (see the JSX at the bottom of this function) rather
  // than `unshift`ing it into the items array. The previous approach
  // caused every later row to shift up by one slot the moment a real
  // thinking arrived (or `isStreaming` flipped off) and the synthetic
  // disappeared. Keeping it out of the row list means the surrounding
  // timeline positions stay stable across that transition.
  const hasRealThinking = mergedTimeline.some((i) => i.kind === "thinking");
  const hasAnyTool = mergedTimeline.some((i) => i.kind === "tool");
  // Only paint the synthetic "Thinking..." while the turn is still in its
  // opening reasoning-less burst: tools have appeared but none have
  // resolved and no text has streamed yet. Previously this lingered for
  // the entire streaming turn (any tool present + no thinking text), so
  // it kept claiming "Thinking..." above rows that had already completed
  // and while later tools ran — feedback the model was demonstrably past.
  const hasResolvedTool = mergedTimeline.some((i) => {
    if (i.kind !== "tool") return false;
    const entry = toolCallMap.get(i.toolCallId);
    // Synthetic `transition_task` lifecycle cards are always non-pending
    // and seed on every TaskStarted, so they must not count as "real work
    // finished" — otherwise the initial reasoning-less placeholder would
    // never paint.
    return entry != null && !entry.synthetic && entry.pending === false;
  });
  const hasTextItem = mergedTimeline.some((i) => i.kind === "text");
  const shouldSynthesizeThinking =
    isStreaming &&
    !hasRealThinking &&
    !thinkingText &&
    hasAnyTool &&
    !hasResolvedTool &&
    !hasTextItem;

  // Phase 5 — feed-wide path disambiguation. Walk the file-op tool
  // entries reachable from this turn's timeline and compute the shortest
  // right-anchored tail that uniquely identifies each path within the
  // visible set. A lone `Cargo.toml` stays a bare basename; two reads of
  // `crates/aura-os-core/Cargo.toml` and `crates/aura-os-cli/Cargo.toml`
  // promote to their full distinguishing tails so operators can tell
  // identical-looking rows apart at a glance.
  const visibleFilePaths: string[] = [];
  for (const item of mergedTimeline) {
    if (item.kind !== "tool") continue;
    const entry = toolCallMap.get(item.toolCallId);
    if (!entry) continue;
    if (!FILE_OPS.has(entry.name)) continue;
    const raw = entry.input?.path;
    if (typeof raw === "string" && raw.length > 0) visibleFilePaths.push(raw);
  }
  const pathTailMap = computeUniquePathTails(visibleFilePaths);

  // Phase 5 — adjacent identical tool-call grouping. Walk the merged
  // timeline once and collapse runs of consecutive tool items sharing
  // `(tool_name, canonical_input)` into a single render slot pointing
  // at the *latest* entry in the run. The first non-matching item (or
  // any non-tool item) breaks the run. Non-tool items pass through
  // verbatim so thinking / text segments still interleave normally.
  interface TimelineSlot {
    item: TimelineItem;
    groupCount?: number;
  }
  const slots: TimelineSlot[] = [];
  let lastGroupKey: string | null = null;
  for (const item of mergedTimeline) {
    if (item.kind !== "tool") {
      slots.push({ item });
      lastGroupKey = null;
      continue;
    }
    const entry = toolCallMap.get(item.toolCallId);
    if (!entry) {
      lastGroupKey = null;
      continue;
    }
    const groupKey = canonicalInputKey(entry.name, entry.input ?? {});
    const prevSlot = slots[slots.length - 1];
    if (
      prevSlot &&
      prevSlot.item.kind === "tool" &&
      lastGroupKey === groupKey
    ) {
      prevSlot.item = item;
      prevSlot.groupCount = (prevSlot.groupCount ?? 1) + 1;
      continue;
    }
    slots.push({ item, groupCount: 1 });
    lastGroupKey = groupKey;
  }

  const items: RenderedItem[] = [];
  for (const slot of slots) {
    const item = slot.item;
    if (item.kind === "thinking") {
      // Prefer per-segment text (set by handleThinkingDelta) so that when
      // multiple thinking runs occur within one turn each block shows only
      // the text that actually belongs to it. Fall back to the global
      // `thinkingText` for historical messages that predate per-segment text.
      const segmentText = item.text ?? thinkingText;
      // Open live segments (no `durationMs` stamped, parent turn still
      // streaming) must render even with empty text so the shimmering
      // Brain "Thinking..." header is visible the instant a thinking
      // slot opens. Closed/historical segments without text still
      // skip — this preserves the no-phantom-block behavior on
      // hydrated terminal turns.
      const isOpenLiveSegment = isStreaming && item.durationMs == null;
      if (!segmentText && !isOpenLiveSegment) continue;
      // Derive a per-segment streaming flag instead of forwarding the
      // turn-level `isStreaming` to every block. Without this, a
      // multi-segment turn (thinking -> tool -> thinking) used to render
      // every block as "Thinking..." with shimmer and `forceExpanded`,
      // even though `closeCurrentThinkingSegment` had already stamped
      // `durationMs` on the earlier segment. `handleThinkingDelta`
      // guarantees at most one open thinking segment at a time (it
      // extends the trailing thinking item instead of pushing a new
      // one), so "no `durationMs`" uniquely identifies the live segment
      // during a turn. Hydrated history rows have no `durationMs`
      // either, but the turn-level `isStreaming` is already `false`
      // there, so this rule still resolves correctly.
      const segmentIsStreaming = isStreaming && item.durationMs == null;
      items.push({
        key: item.id,
        kind: "thinking",
        toolPosition: null,
        text: segmentText ?? "",
        isStreaming: segmentIsStreaming,
        // Prefer the per-segment `durationMs` stamped by
        // `closeCurrentThinkingSegment`; fall back to the
        // turn-level total for hydrated history rows that
        // predate per-segment tracking. This is what stops
        // multi-segment turns from rendering the same
        // "Thought for X" label on every block.
        durationMs: item.durationMs ?? thinkingDurationMs,
        defaultExpanded: defaultThinkingExpanded,
      });
    } else if (item.kind === "tool") {
      const entry = toolCallMap.get(item.toolCallId);
      if (!entry) continue;
      // Just-finalized bubbles (defaultActivitiesExpanded=true) mirror the
      // StreamingBubble's state so the tools with rich live previews stay
      // visible. Historical bubbles (false) and reads/lists/deletes stay
      // collapsed so the turn reads as a tight checklist.
      const auto = isAutoExpandedTool(entry.name);
      const defaultToolExpanded = defaultActivitiesExpanded
        ? auto
        : entry.pending && auto;
      // Surface the feed-wide disambiguating tail for file ops and the
      // collapsed-run badge count for any tool whose previous adjacent
      // siblings shared its `(name, input)` fingerprint.
      let displayPath: string | undefined;
      if (FILE_OPS.has(entry.name)) {
        const raw = entry.input?.path;
        if (typeof raw === "string" && raw.length > 0) {
          displayPath = pathTailMap.get(raw);
        }
      }
      const groupCount =
        slot.groupCount && slot.groupCount >= 2 ? slot.groupCount : undefined;
      items.push({
        key: item.id,
        kind: "tool",
        // Position is filled in by a second pass below once we know each
        // tool row's neighbours.
        toolPosition: "solo",
        entry,
        defaultExpanded: defaultToolExpanded,
        displayPath,
        groupCount,
      });
    } else {
      items.push({
        key: item.id,
        kind: "text",
        toolPosition: null,
        content: item.content,
        isStreaming,
      });
    }
  }

  // Mark each tool row with its position inside a run of adjacent tools
  // (`first`, `mid`, `last`, `solo`). The wrapper `<div className="toolGroup">`
  // that previously enclosed each run has been replaced by per-row data
  // attributes so each row can live in its own virtualizer slot. The styling
  // owned by `.toolGroup` in `ActivityTimeline.module.css` now lives behind
  // these data attributes via adjacent-sibling selectors.
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind !== "tool") continue;
    const prevIsTool = i > 0 && items[i - 1].kind === "tool";
    const nextIsTool = i < items.length - 1 && items[i + 1].kind === "tool";
    let pos: ToolPosition;
    if (!prevIsTool && !nextIsTool) pos = "solo";
    else if (!prevIsTool && nextIsTool) pos = "first";
    else if (prevIsTool && nextIsTool) pos = "mid";
    else pos = "last";
    items[i] = { ...items[i], toolPosition: pos };
  }

  // Virtualization is only worth its cost on the *hydrated* terminal
  // view, where row heights are stable and the list can be hundreds
  // of items long. While `isStreaming` is true, rows are mounting,
  // growing, and resolving (pending → done) every frame, which makes
  // `useVirtualizer`'s `measureElement`-driven `translateY`
  // recalculation visibly shift the entire list on every tick. We
  // fall back to the plain flex layout for live streams and only
  // engage the virtualizer once streaming ends OR the row count
  // crosses a threshold that justifies the trade-off (chosen
  // generously so most active runs stay in the stable code path).
  const VIRTUALIZE_ROW_THRESHOLD = 60;
  const shouldVirtualize =
    !!scrollRef && (!isStreaming || items.length >= VIRTUALIZE_ROW_THRESHOLD);

  return (
    <>
      {shouldSynthesizeThinking && (
        <ThinkingBlock
          text=""
          isStreaming
          durationMs={undefined}
          defaultExpanded={defaultThinkingExpanded}
        />
      )}
      {shouldVirtualize && scrollRef ? (
        <VirtualizedTimeline items={items} scrollRef={scrollRef} />
      ) : (
        <PlainTimeline items={items} />
      )}
    </>
  );
}

function rowDataAttrs(item: RenderedItem): Record<string, string> {
  const attrs: Record<string, string> = { "data-kind": item.kind };
  // Flag rows whose rendered node is a `Block` primitive so the
  // border-collapse rule in `ActivityTimeline.module.css` can fire on
  // any two adjacent bordered rows (thinking + tool, tool + thinking,
  // tool + tool, …) instead of only tool-tool runs. Text rows render
  // bare markdown with no border, so they intentionally stay off this
  // attribute and keep their full 12px breathing-room margin.
  if (item.kind === "tool" || item.kind === "thinking") {
    attrs["data-block-row"] = "true";
  }
  if (item.kind === "tool" && item.toolPosition) {
    attrs["data-tool-position"] = item.toolPosition;
  }
  return attrs;
}

function PlainTimeline({ items }: { items: RenderedItem[] }) {
  return (
    <div className={styles.timeline}>
      {items.map((item) => (
        <div key={item.key} {...rowDataAttrs(item)}>
          <TimelineRow item={item} />
        </div>
      ))}
    </div>
  );
}

function VirtualizedTimeline({
  items,
  scrollRef,
}: {
  items: RenderedItem[];
  scrollRef: RefObject<HTMLElement | null>;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(wrapperRef, scrollRef);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    // Tool blocks are usually compact (collapsed headers); thinking and
    // text segments are larger. 96px is a reasonable midpoint that keeps
    // the initial total size close to reality before measureElement
    // settles each row.
    estimateSize: () => 96,
    overscan: 6,
    getItemKey: (index) => items[index]?.key ?? index,
    scrollMargin,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  return (
    <div
      ref={wrapperRef}
      className={`${styles.timeline} ${styles.timelineVirtual}`}
      style={{ height: `${totalSize}px` }}
    >
      {virtualItems.map((vi) => {
        const item = items[vi.index];
        if (!item) return null;
        return (
          <div
            key={vi.key}
            ref={virtualizer.measureElement}
            data-index={vi.index}
            {...rowDataAttrs(item)}
            className={styles.virtualRow}
            style={{
              transform: `translateY(${vi.start - scrollMargin}px)`,
            }}
          >
            <TimelineRow item={item} />
          </div>
        );
      })}
    </div>
  );
}
