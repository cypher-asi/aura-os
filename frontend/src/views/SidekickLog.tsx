import { useEffect, useRef, useState, useCallback } from "react";
import { useEventContext } from "../context/EventContext";
import { Button, Text } from "@cypher-asi/zui";
import styles from "../components/Sidekick.module.css";

interface LogEntry {
  timestamp: string;
  message: string;
  isEvent: boolean;
}

const MAX_LINES = 1000;

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SidekickLog() {
  const { subscribe } = useEventContext();
  const [lines, setLines] = useState<LogEntry[]>([]);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const addLine = useCallback((message: string, isEvent = false) => {
    setLines((prev) => {
      const entry: LogEntry = {
        timestamp: formatTime(new Date()),
        message,
        isEvent,
      };
      const next = [...prev, entry];
      return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
    });
  }, []);

  useEffect(() => {
    const unsubs = [
      subscribe("log_line", (e) => {
        addLine(e.message || "", false);
      }),
      subscribe("task_started", (e) => {
        addLine(`Started: ${e.task_title || e.task_id}`, true);
      }),
      subscribe("task_completed", (e) => {
        addLine(`Completed: ${e.task_id}`, true);
      }),
      subscribe("task_failed", (e) => {
        addLine(`Failed: ${e.task_id} — ${e.reason || "unknown"}`, true);
      }),
      subscribe("session_rolled_over", (e) => {
        addLine(
          `Context rotated → Session ${e.new_session_id?.slice(0, 8)}`,
          true,
        );
      }),
      subscribe("loop_started", () => {
        addLine("Dev loop started", true);
      }),
      subscribe("loop_paused", (e) => {
        addLine(`Loop paused (${e.completed_count} completed)`, true);
      }),
      subscribe("loop_stopped", (e) => {
        addLine(`Loop stopped (${e.completed_count} completed)`, true);
      }),
      subscribe("loop_finished", (e) => {
        addLine(`Loop finished: ${e.outcome}`, true);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, addLine]);

  useEffect(() => {
    if (autoScrollRef.current && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [lines]);

  const handleScroll = () => {
    const el = contentRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    autoScrollRef.current = atBottom;
  };

  return (
    <div className={styles.logWrap}>
      <div className={styles.logHeader}>
        <Button variant="ghost" size="sm" onClick={() => setLines([])}>
          Clear
        </Button>
      </div>
      <div
        ref={contentRef}
        className={styles.logContent}
        onScroll={handleScroll}
      >
        {lines.length === 0 ? (
          <Text variant="muted" size="sm">Waiting for events...</Text>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={styles.logLine}>
              <span className={styles.logTimestamp}>[{line.timestamp}]</span>
              <span className={line.isEvent ? styles.logEvent : undefined}>
                {line.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
