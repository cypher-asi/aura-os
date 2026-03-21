import { useState, useRef, useCallback } from "react";
import { Text, GroupCollapsible } from "@cypher-asi/zui";
import { Loader2, Check, CheckCheck, Copy, Terminal } from "lucide-react";
import { IterationBar } from "./IterationBar";
import { FormattedRawOutput } from "./FormattedRawOutput";
import type { IterationStats } from "../utils/derive-activity";
import styles from "./Preview.module.css";

interface ActivityItem {
  id: string;
  message: string;
  status: string;
  detail?: string;
}

export interface TaskOutputSectionProps {
  isActive: boolean;
  activity: ActivityItem[];
  iterStats: IterationStats;
  streamBuf: string;
}

export function TaskOutputSection({
  isActive,
  activity,
  iterStats,
  streamBuf,
}: TaskOutputSectionProps) {
  const [showRawOutput, setShowRawOutput] = useState(false);
  const rawOutputRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copyRawOutput = useCallback(() => {
    void navigator.clipboard.writeText(streamBuf).then(() => {
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  }, [streamBuf]);

  if (activity.length === 0) return null;

  return (
    <GroupCollapsible label={isActive ? "Live Output" : "Output"} defaultOpen className={styles.section}>
      {iterStats.total > 0 && (
        <IterationBar stats={iterStats} dots={iterStats.dots} isActive={isActive} />
      )}
      <div className={styles.liveOutputSection}>
        <div className={styles.activityList}>
          {activity.map((item) => (
            <div key={item.id} className={styles.activityItem} data-status={item.status}>
              <span className={styles.activityIcon} data-status={item.status}>
                {item.status === "active"
                  ? <Loader2 size={12} className={styles.spinner} />
                  : <Check size={12} />}
              </span>
              <span className={styles.activityBody}>
                <span className={styles.activityMessage}>{item.message}</span>
                {item.detail && (
                  <span className={styles.activityDetail}> {item.detail}</span>
                )}
              </span>
            </div>
          ))}
        </div>
        {streamBuf.length > 0 && (
          <div className={styles.rawOutputToggleRow}>
            <button
              className={styles.rawOutputToggle}
              onClick={() => setShowRawOutput((v) => !v)}
            >
              <Terminal size={11} />
              {showRawOutput ? "Hide raw output" : "Show raw output"}
            </button>
            <div className={styles.rawOutputActions}>
              <Text variant="muted" size="xs" className={styles.streamProgress}>
                {(streamBuf.length / 1024).toFixed(1)} KB
              </Text>
              <button
                className={styles.copyRawBtn}
                onClick={copyRawOutput}
                aria-label="Copy raw output"
              >
                {copied ? <CheckCheck size={11} /> : <Copy size={11} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}
        {showRawOutput && streamBuf.length > 0 && (
          <FormattedRawOutput ref={rawOutputRef} buffer={streamBuf} />
        )}
      </div>
    </GroupCollapsible>
  );
}
