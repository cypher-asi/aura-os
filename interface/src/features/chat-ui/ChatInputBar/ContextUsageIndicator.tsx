import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronRight, X } from "lucide-react";
import type { ContextBreakdown } from "../../../stores/context-usage-store";
import { computeSessionCost } from "../../../constants/model-pricing";
import { modelLabel } from "../../../constants/models";
import { SessionCostSection, type SessionCostView } from "../SessionCostSection";
import { CacheInfoOverlay } from "./CacheInfoOverlay";
import { CollapsibleSection } from "./CollapsibleSection";
import styles from "./ChatInputBar.module.css";

export interface ContextUsageIndicatorProps {
  utilization: number;
  estimatedTokens?: number;
  /**
   * Per-bucket token estimates for the current session context.
   * When present, the popover renders the Cursor-style stacked-bar
   * breakdown (System prompt / Tools / Skills / MCP / Subagents /
   * Conversation). When absent (older harness builds, dev-loop
   * fallback, or fresh hydrate before the first turn), the popover
   * falls back to the legacy two-row Used/Total view so nothing
   * regresses.
   */
  breakdown?: ContextBreakdown;
  /**
   * Session-cumulative usage for the "Session Cost" section. When
   * `model` plus a positive input/output count is present, the popover
   * renders cost; otherwise the section is omitted.
   */
  model?: string;
  provider?: string;
  cumulativeInputTokens?: number;
  cumulativeOutputTokens?: number;
  cumulativeCacheReadTokens?: number;
  cumulativeCacheCreationTokens?: number;
  /**
   * Invoked when a breakdown row is clicked. The presentational
   * indicator stays free of stores/fetching — the chat input bar wires
   * this to lazily fetch the bucket's rendered text and open the
   * Sidekick preview. When omitted, the rows render as inert buttons
   * (still keyboard/focus accessible) so older mount points don't
   * regress.
   */
  onOpenBucket?: (bucketId: ContextBucketRowId) => void;
}

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

/**
 * Geometry for the inline progress ring drawn next to the percentage
 * label. The viewBox is intentionally larger than the rendered size so
 * the stroke renders crisply at 12px on hi-dpi displays. Track and
 * progress arcs share the same circle path; the progress arc uses
 * `stroke-dasharray` / `stroke-dashoffset` to expose the utilization,
 * and a `-90deg` rotation on the SVG itself moves the arc's start
 * point from 3 o'clock to 12 o'clock.
 */
const RING_VIEWBOX = 16;
const RING_RADIUS = 6;
const RING_STROKE = 2.25;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatTokens(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return TOKEN_FORMATTER.format(Math.round(value));
}

/**
 * Compact "12.3K" style for the popover's token-count summary line so
 * it matches the visual density of the screenshot. Uses fixed-precision
 * 1-decimal `K` past 10K and integer `K` past 100K so two adjacent
 * popovers (Used vs Total) line up nicely.
 */
function formatTokensShort(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = Math.round(value);
  if (v < 1_000) return `${v}`;
  if (v < 10_000) return `${(v / 1_000).toFixed(1)}K`;
  if (v < 1_000_000) return `${Math.round(v / 1_000)}K`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

interface BucketRow {
  /** Stable id used for color-coding and `data-context-bucket`. */
  id: "system_prompt" | "tools" | "skills" | "mcp" | "subagents" | "conversation";
  label: string;
  tokens: number;
}

export type ContextBucketRowId = BucketRow["id"];

/**
 * Order matches the screenshot: System prompt, Tools, Skills, MCP,
 * Subagents, Conversation. `Conversation` lives at the bottom because
 * it's the dominant bucket on long sessions.
 */
function buildBucketRows(b: ContextBreakdown): BucketRow[] {
  return [
    { id: "system_prompt", label: "System prompt", tokens: b.systemPromptTokens },
    { id: "tools", label: "Tools", tokens: b.toolsTokens },
    { id: "skills", label: "Skills", tokens: b.skillsTokens },
    { id: "mcp", label: "MCP", tokens: b.mcpTokens },
    { id: "subagents", label: "Subagents", tokens: b.subagentsTokens },
    { id: "conversation", label: "Conversation", tokens: b.conversationTokens },
  ];
}

/**
 * Build the presentational view for the Session Cost section from the
 * cumulative usage props, or `null` when there isn't enough data yet
 * (no model, or no tokens consumed). Cost math is delegated to the pure
 * `model-pricing` util so this stays a thin adapter.
 */
function buildSessionCostView(
  props: Pick<
    ContextUsageIndicatorProps,
    | "model"
    | "provider"
    | "cumulativeInputTokens"
    | "cumulativeOutputTokens"
    | "cumulativeCacheReadTokens"
    | "cumulativeCacheCreationTokens"
  >,
): SessionCostView | null {
  const { model } = props;
  if (!model) return null;
  const inputTokens = props.cumulativeInputTokens ?? 0;
  const outputTokens = props.cumulativeOutputTokens ?? 0;
  const cacheReadTokens = props.cumulativeCacheReadTokens ?? 0;
  const cacheCreationTokens = props.cumulativeCacheCreationTokens ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0) return null;
  const cost = computeSessionCost({
    model,
    provider: props.provider,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  });
  return {
    modelLabel: modelLabel(model),
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: cost.totalTokens,
    avgCostPerMillionUsd: cost.avgCostPerMillionUsd,
    totalCostUsd: cost.totalCostUsd,
    inputRatePerMillionUsd: cost.pricing.input,
    outputRatePerMillionUsd: cost.pricing.output,
    cachedRatePerMillionUsd: cost.pricing.cacheRead,
    unknown: cost.unknown,
  };
}

/**
 * Click-toggle popover for the bottom-bar context-window indicator.
 * The visible trigger is a tiny progress ring + lowercase "NN% context"
 * label; clicking it toggles the popover, and clicks outside dismiss
 * it. Hover intentionally does NOT open the panel — the indicator sits
 * on the chat input bar where stray hovers would constantly cover the
 * composer. There is no inline reset affordance — to reset the
 * context, start a new session via the chat header's "+" new-chat
 * button.
 *
 * Two popover variants live here:
 *  - When `breakdown` is populated, render the Cursor-style stacked-bar
 *    breakdown that shows the percentage, total tokens, and a
 *    color-coded segment per bucket alongside a labeled list.
 *  - Otherwise fall back to the legacy three-row "Context / Used /
 *    Total" card so older harness builds and the pre-first-turn state
 *    still communicate something useful.
 */
export const ContextUsageIndicator = memo(function ContextUsageIndicator({
  utilization,
  estimatedTokens,
  breakdown,
  model,
  provider,
  cumulativeInputTokens,
  cumulativeOutputTokens,
  cumulativeCacheReadTokens,
  cumulativeCacheCreationTokens,
  onOpenBucket,
}: ContextUsageIndicatorProps) {
  const [open, setOpen] = useState(false);
  // Collapsible sections inside the breakdown popover. Context Composition
  // is the primary view so it starts expanded; Session Cost is secondary
  // and starts collapsed.
  const [compositionOpen, setCompositionOpen] = useState(true);
  const [costOpen, setCostOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const sessionCostView = buildSessionCostView({
    model,
    provider,
    cumulativeInputTokens,
    cumulativeOutputTokens,
    cumulativeCacheReadTokens,
    cumulativeCacheCreationTokens,
  });

  const handleClick = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);
  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((prev) => !prev);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }, []);
  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);
  const toggleComposition = useCallback(() => setCompositionOpen((prev) => !prev), []);
  const toggleCost = useCallback(() => setCostOpen((prev) => !prev), []);
  const handleOpenBucket = useCallback(
    (bucketId: ContextBucketRowId) => {
      if (!onOpenBucket) return;
      onOpenBucket(bucketId);
      // Keep the popover open so the user can click through multiple
      // buckets without reopening it each time. It dismisses only when
      // the user clicks outside both the popover and the Sidekick panel
      // (see the click-outside handler below), or via Escape / the X.
    },
    [onOpenBucket],
  );

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // Clicks inside the popover/indicator never dismiss it.
      if (wrapperRef.current?.contains(target)) return;
      // Nor do clicks inside the Sidekick (the panel itself or the
      // preview overlay where the selected bucket's info renders) — this
      // lets the user browse multiple sections while the popover stays
      // open.
      if (
        target instanceof Element &&
        target.closest(
          '[data-agent-surface="sidekick-panel"],[data-agent-surface="sidekick-preview"]',
        )
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const percent = Math.round(utilization * 100);
  const safeUtilization = Math.max(0, Math.min(1, utilization));
  const ringDashOffset = RING_CIRCUMFERENCE * (1 - safeUtilization);
  const usedTokens = typeof estimatedTokens === "number" ? estimatedTokens : undefined;
  const totalTokens =
    usedTokens != null && utilization > 0 ? usedTokens / utilization : undefined;
  const hasTokens = usedTokens != null && totalTokens != null;

  const toneClass =
    utilization >= 0.9
      ? styles.contextDanger
      : utilization >= 0.7
        ? styles.contextWarning
        : "";

  const bucketRows: BucketRow[] = useMemo(
    () => (breakdown ? buildBucketRows(breakdown) : []),
    [breakdown],
  );
  // Hide MCP until the harness gains it (today the bucket is hard-zero
  // by design); never hide Conversation even when it's zero, so the
  // breakdown always shows the dominant bucket label.
  const visibleRows = useMemo(
    () =>
      bucketRows.filter(
        (r) => r.id === "conversation" || (r.id === "mcp" ? r.tokens > 0 : true),
      ),
    [bucketRows],
  );
  // The bar's total width represents the model's context window; each
  // segment's width is its bucket's share of the *window*, not just of
  // the used portion. That keeps the trailing empty space in the bar
  // visually meaningful as "headroom you still have".
  const segments = useMemo(() => {
    if (!breakdown || totalTokens == null || totalTokens <= 0) return [];
    return bucketRows
      .filter((r) => r.tokens > 0)
      .map((r) => ({
        ...r,
        widthPct: Math.min(100, (r.tokens / totalTokens) * 100),
      }));
  }, [bucketRows, breakdown, totalTokens]);

  return (
    <span ref={wrapperRef} className={styles.contextUsageWrap}>
      <span
        className={`${styles.contextIndicator}${toneClass ? ` ${toneClass}` : ""}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg
          className={styles.contextIndicatorRing}
          viewBox={`0 0 ${RING_VIEWBOX} ${RING_VIEWBOX}`}
          role="img"
          aria-label={`Context: ${percent}% used`}
          focusable="false"
        >
          <circle
            className={styles.contextIndicatorRingTrack}
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
          />
          <circle
            className={styles.contextIndicatorRingProgress}
            cx={RING_VIEWBOX / 2}
            cy={RING_VIEWBOX / 2}
            r={RING_RADIUS}
            fill="none"
            strokeWidth={RING_STROKE}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={ringDashOffset}
            strokeLinecap="round"
          />
        </svg>
        <span className={styles.contextIndicatorLabel}>{percent}% context</span>
      </span>

      {open && breakdown && hasTokens && (
        <div
          className={styles.contextBreakdownCard}
          role="dialog"
          aria-label="Context breakdown"
          data-agent-surface="chat-context-breakdown"
        >
          <div className={styles.contextBreakdownHeader}>
            <span className={styles.contextBreakdownTitle}>Context</span>
            <button
              type="button"
              className={styles.contextBreakdownClose}
              onClick={handleClose}
              aria-label="Close context breakdown"
            >
              <X size={12} />
            </button>
          </div>

          <div className={styles.contextSection}>
            <button
              type="button"
              className={styles.contextSectionHeader}
              onClick={toggleComposition}
              aria-expanded={compositionOpen}
            >
              <span className={styles.contextSectionHeaderLabel}>Context Composition</span>
              <ChevronRight
                size={12}
                className={styles.contextSectionChevron}
                data-open={compositionOpen}
              />
            </button>
            <CollapsibleSection open={compositionOpen}>
                <div className={styles.contextSectionBody}>
              <div className={styles.contextBreakdownSummary}>
                <span
                  className={`${styles.contextBreakdownPercent}${toneClass ? ` ${toneClass}` : ""}`}
                >
                  {percent}% Full
                </span>
                <span className={styles.contextBreakdownTokens}>
                  ~{formatTokensShort(usedTokens)} / {formatTokensShort(totalTokens)} Tokens
                </span>
              </div>
              <div
                className={styles.contextBreakdownBar}
                role="img"
                aria-label={`Context usage: ${percent} percent of the model window`}
              >
                {segments.map((s) => (
                  <span
                    key={s.id}
                    className={styles.contextBreakdownSegment}
                    data-context-bucket={s.id}
                    style={{ flexBasis: `${s.widthPct}%` }}
                    title={`${s.label}: ${formatTokens(s.tokens)} tokens`}
                  />
                ))}
              </div>
              <div className={styles.contextBreakdownList}>
                {visibleRows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`${styles.contextBreakdownRow} ${styles.contextBreakdownRowButton}`}
                    data-context-bucket-row={row.id}
                    aria-label={`View ${row.label} context`}
                    onClick={() => handleOpenBucket(row.id)}
                  >
                    <span className={styles.contextBreakdownRowLeft}>
                      <span
                        className={styles.contextBreakdownSwatch}
                        data-context-bucket={row.id}
                        aria-hidden="true"
                      />
                      {row.label}
                    </span>
                    <span className={styles.contextBreakdownRowValue}>
                      {formatTokensShort(row.tokens)}
                    </span>
                  </button>
                ))}
                {(breakdown.cacheReadTokens > 0 ||
                  breakdown.cacheCreationTokens > 0) && (
                  <div
                    className={styles.contextBreakdownRow}
                    data-context-bucket-row="cached"
                    data-cache-row
                  >
                    <span className={styles.contextBreakdownRowLeft}>Cached</span>
                    <span
                      className={`${styles.contextBreakdownRowValue} ${styles.contextBreakdownCacheValue}`}
                    >
                      <CacheInfoOverlay
                        readTokens={breakdown.cacheReadTokens}
                        writtenTokens={breakdown.cacheCreationTokens}
                        formatTokens={(v) => `${formatTokensShort(v)}`}
                      />
                      {(() => {
                        const total =
                          breakdown.cacheReadTokens + breakdown.cacheCreationTokens;
                        const hitPct =
                          total === 0
                            ? 0
                            : Math.round((breakdown.cacheReadTokens / total) * 100);
                        return `${hitPct}% hit`;
                      })()}
                    </span>
                  </div>
                )}
                </div>
                </div>
            </CollapsibleSection>
          </div>

          {sessionCostView && (
            <div className={styles.contextSection}>
              <button
                type="button"
                className={styles.contextSectionHeader}
                onClick={toggleCost}
                aria-expanded={costOpen}
              >
                <span className={styles.contextSectionHeaderLabel}>Session Cost</span>
                <ChevronRight
                  size={12}
                  className={styles.contextSectionChevron}
                  data-open={costOpen}
                />
              </button>
              <CollapsibleSection open={costOpen}>
                <SessionCostSection view={sessionCostView} showTitle={false} />
              </CollapsibleSection>
            </div>
          )}
        </div>
      )}

      {open && (!breakdown || !hasTokens) && (
        <div className={styles.contextUsageCard} role="dialog">
          <div className={styles.contextUsageRow}>
            <span className={styles.contextUsageLabel}>Context</span>
            <span className={`${styles.contextUsageValue}${toneClass ? ` ${toneClass}` : ""}`}>
              {percent}% used
            </span>
          </div>
          {hasTokens && (
            <>
              <div className={styles.contextUsageRow}>
                <span className={styles.contextUsageLabel}>Used</span>
                <span className={styles.contextUsageValue}>
                  {formatTokens(usedTokens)} tokens
                </span>
              </div>
              <div className={styles.contextUsageRow}>
                <span className={styles.contextUsageLabel}>Total</span>
                <span className={styles.contextUsageValue}>
                  {formatTokens(totalTokens)} tokens
                </span>
              </div>
            </>
          )}
          {!hasTokens && (
            <div className={styles.contextUsageHint}>
              Token counts appear after the next assistant turn.
            </div>
          )}
          {sessionCostView && <SessionCostSection view={sessionCostView} />}
        </div>
      )}
    </span>
  );
});
