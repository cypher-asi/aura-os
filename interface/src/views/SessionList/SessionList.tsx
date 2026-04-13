import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { OverlayScrollbar } from "../../components/OverlayScrollbar";
import { StatusBadge } from "../../components/StatusBadge";
import { formatTokens } from "../../utils/format";
import { EmptyState } from "../../components/EmptyState";
import { api } from "../../api/client";
import { useSessionListData } from "./useSessionListData";
import styles from "./SessionList.module.css";

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  const diffSec = Math.floor((end - start) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  if (min < 60) return `${min}m ${sec}s`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

export function SessionList({ searchQuery }: { searchQuery: string }) {
  const navigate = useNavigate();
  const { sessions, loading, selectedId, setSelectedId } = useSessionListData();
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    for (const session of sessions) {
      if (session.summary_of_previous_context) {
        setSummaries((prev) => {
          if (prev[session.session_id] === session.summary_of_previous_context) return prev;
          return { ...prev, [session.session_id]: session.summary_of_previous_context };
        });
      } else if (
        session.status !== "active" &&
        !summarizingRef.current.has(session.session_id)
      ) {
        summarizingRef.current.add(session.session_id);
        api
          .summarizeSession(
            session.project_id,
            session.agent_instance_id,
            session.session_id,
          )
          .then((updated) => {
            if (updated.summary_of_previous_context) {
              setSummaries((prev) => ({
                ...prev,
                [session.session_id]: updated.summary_of_previous_context,
              }));
            }
          })
          .catch(() => {});
      }
    }
  }, [sessions]);

  const filtered = useMemo(() => {
    if (!searchQuery) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter((s, i) => {
      const num = `S${sessions.length - i}`.toLowerCase();
      const summary = (summaries[s.session_id] ?? "").toLowerCase();
      return num.includes(q) || summary.includes(q) || s.session_id.includes(q);
    });
  }, [sessions, searchQuery, summaries]);

  const isEmpty = sessions.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <div className={styles.sessionListShell}>
      <div ref={scrollRef} className={styles.sessionListWrap}>
        {filtered.map((session) => {
          const totalTokens = session.total_input_tokens + session.total_output_tokens;
          const number = sessions.length - sessions.indexOf(session);
          const summary = summaries[session.session_id];
          const isSelected = selectedId === session.session_id;

          return (
            <div
              key={session.session_id}
              className={`${styles.sessionCard} ${isSelected ? styles.sessionCardSelected : ""}`}
              onClick={() => {
                setSelectedId(session.session_id);
                navigate(
                  `/projects/${session.project_id}/agents/${session.agent_instance_id}?session=${session.session_id}`,
                );
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  setSelectedId(session.session_id);
                  navigate(
                    `/projects/${session.project_id}/agents/${session.agent_instance_id}?session=${session.session_id}`,
                  );
                }
              }}
            >
              <div className={styles.sessionCardHeader}>
                <StatusBadge status={session.status} />
                <span className={styles.sessionNumber}>S{number}</span>
                <span className={styles.sessionMeta}>
                  <span className={styles.sessionDuration}>
                    {formatDuration(session.started_at, session.ended_at)}
                  </span>
                  {totalTokens > 0 && (
                    <span className={styles.sessionCost}>
                      {formatTokens(totalTokens)}
                    </span>
                  )}
                </span>
              </div>
              {summary && <div className={styles.sessionSummary}>{summary}</div>}
              {!summary && session.status !== "active" && summarizingRef.current.has(session.session_id) && (
                <div className={styles.sessionSummaryPlaceholder}>Generating summary...</div>
              )}
            </div>
          );
        })}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
}
