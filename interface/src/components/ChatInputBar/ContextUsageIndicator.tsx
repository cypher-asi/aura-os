import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import styles from "./ChatInputBar.module.css";

export interface ContextUsageIndicatorProps {
  utilization: number;
  estimatedTokens?: number;
  onNewSession?: () => void;
}

const TOKEN_FORMATTER = new Intl.NumberFormat("en-US");

function formatTokens(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return TOKEN_FORMATTER.format(Math.round(value));
}

/**
 * Hover/pin popover for the bottom-bar context-window indicator. The
 * visible trigger keeps the legacy "NN%" pill and the reset button; the
 * popover that appears above (mirroring AgentEnvironment's status card)
 * exposes the raw token numbers alongside the percentage.
 *
 * Total context is derived from `estimatedTokens / utilization` — the
 * backend only emits the ratio and used tokens, so we back out the
 * model's advertised window here. When either is missing (e.g. the
 * dev-loop fallback, or before the first stream turn on a freshly
 * hydrated REST seed), we hide the Used/Total rows and only show the
 * percentage so the popover still communicates something useful.
 */
export function ContextUsageIndicator({
  utilization,
  estimatedTokens,
  onNewSession,
}: ContextUsageIndicatorProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = useCallback(() => {
    if (!pinned) setOpen(true);
  }, [pinned]);
  const handleMouseLeave = useCallback(() => {
    if (!pinned) setOpen(false);
  }, [pinned]);
  const handleClick = useCallback(() => {
    if (pinned) {
      setPinned(false);
      setOpen(false);
    } else {
      setPinned(true);
      setOpen(true);
    }
  }, [pinned]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  const percent = Math.round(utilization * 100);
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

  return (
    <span
      ref={wrapperRef}
      className={styles.contextUsageWrap}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <span
        className={`${styles.contextIndicator}${toneClass ? ` ${toneClass}` : ""}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        {percent}%
      </span>
      {onNewSession ? (
        <button
          type="button"
          className={styles.newSessionButton}
          onClick={onNewSession}
          aria-label="Start new session"
        >
          <RotateCcw size={10} />
        </button>
      ) : null}

      {open && (
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
        </div>
      )}
    </span>
  );
}
