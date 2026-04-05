import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../../../components/EmptyState";
import { api } from "../../../api/client";
import { type AnnotatedSession } from "./agent-info-utils";
import { SessionCard } from "./SessionsSection";
import type { Agent, Task } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

function useAgentSessions(
  agentId: string,
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[],
) {
  const [sessions, setSessions] = useState<AnnotatedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (projectBindings.length === 0) {
      setSessions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all(
      projectBindings.map((b) =>
        api.listSessions(b.project_id, b.project_agent_id)
          .then((list) =>
            list.map((s) => ({
              ...s,
              _projectName: b.project_name,
              _projectId: b.project_id,
              _agentInstanceId: b.project_agent_id,
            })),
          )
          .catch(() => [] as AnnotatedSession[]),
      ),
    ).then((results) => {
      if (cancelled) return;
      const all = results
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
      setSessions(all);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [agentId, projectBindings]);

  return { sessions, loading };
}

function useSessionSummaries(sessions: AnnotatedSession[]) {
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const session of sessions) {
      if (session.summary_of_previous_context) {
        setSummaries((prev) => ({
          ...prev,
          [session.session_id]: session.summary_of_previous_context,
        }));
      } else if (
        session.status !== "active" &&
        !summarizingRef.current.has(session.session_id)
      ) {
        summarizingRef.current.add(session.session_id);
        api
          .summarizeSession(session._projectId, session._agentInstanceId, session.session_id)
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

  return { summaries, summarizingRef };
}

function useSessionExpansion(sessions: AnnotatedSession[]) {
  const taskCacheRef = useRef<Map<string, Task[]>>(new Map());
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Record<string, Task[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<Set<string>>(new Set());

  const toggleExpand = useCallback(
    (sessionId: string) => {
      setExpandedSessions((prev) => {
        const next = new Set(prev);
        if (next.has(sessionId)) {
          next.delete(sessionId);
        } else {
          next.add(sessionId);
          if (!taskCacheRef.current.has(sessionId) && !loadingTasks.has(sessionId)) {
            const session = sessions.find((s) => s.session_id === sessionId);
            if (session) {
              setLoadingTasks((p) => new Set(p).add(sessionId));
              api
                .listSessionTasks(session._projectId, session._agentInstanceId, session.session_id)
                .then((tasks) => {
                  taskCacheRef.current.set(sessionId, tasks);
                  setExpandedTasks((p) => ({ ...p, [sessionId]: tasks }));
                })
                .catch(() => {
                  taskCacheRef.current.set(sessionId, []);
                  setExpandedTasks((p) => ({ ...p, [sessionId]: [] }));
                })
                .finally(() => {
                  setLoadingTasks((p) => {
                    const n = new Set(p);
                    n.delete(sessionId);
                    return n;
                  });
                });
            }
          }
        }
        return next;
      });
    },
    [sessions, loadingTasks],
  );

  return { expandedSessions, expandedTasks, loadingTasks, toggleExpand };
}

export function ChatsTab({
  agent,
  projectBindings,
}: {
  agent: Agent;
  projectBindings: { project_agent_id: string; project_id: string; project_name: string }[];
}) {
  const navigate = useNavigate();
  const { sessions, loading } = useAgentSessions(agent.agent_id, projectBindings);
  const { summaries, summarizingRef } = useSessionSummaries(sessions);
  const { expandedSessions, expandedTasks, loadingTasks, toggleExpand } =
    useSessionExpansion(sessions);

  const handleSessionClick = useCallback(
    (session: AnnotatedSession) => {
      navigate(
        `/projects/${session._projectId}/agents/${session._agentInstanceId}?session=${session.session_id}`,
      );
    },
    [navigate],
  );

  if (loading) {
    return <div className={styles.tabEmptyState}>Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <div className={styles.sessionListWrap}>
      {sessions.map((session, index) => (
        <SessionCard
          key={session.session_id}
          session={session}
          number={sessions.length - index}
          expanded={expandedSessions.has(session.session_id)}
          tasks={expandedTasks[session.session_id]}
          isLoadingTasks={loadingTasks.has(session.session_id)}
          summary={summaries[session.session_id]}
          isSummarizing={summarizingRef.current.has(session.session_id)}
          onToggle={() => toggleExpand(session.session_id)}
          onClick={() => handleSessionClick(session)}
        />
      ))}
    </div>
  );
}
