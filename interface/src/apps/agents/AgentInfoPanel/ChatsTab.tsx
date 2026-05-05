import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "../../../components/EmptyState";
import { api } from "../../../api/client";
import { type AnnotatedSession, getDateBucket } from "./agent-info-utils";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../../components/SidekickItemContextMenu";
import type { Agent } from "../../../shared/types";
import styles from "./AgentInfoPanel.module.css";

function truncate(text: string, max: number): string {
  const first = text.split("\n")[0].trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1)}…`;
}

type ProjectBinding = {
  project_agent_id: string;
  project_id: string;
  project_name: string;
};

function useAgentSessions(
  agentId: string,
  projectBindings: ProjectBinding[],
) {
  const [sessions, setSessions] = useState<AnnotatedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // Always run through Promise.all so empty-bindings still goes through the
    // same async path (avoids a synchronous setState branch in the effect).
    // `loading` starts true via useState and is flipped to false by the
    // resolved callback below; we don't reset it on subsequent re-fetches,
    // matching `useSessionListData`'s "loading is only the initial signal"
    // pattern, so we never trigger a synchronous setState in this effect.
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

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  const restoreSession = useCallback((session: AnnotatedSession) => {
    setSessions((prev) => {
      if (prev.some((s) => s.session_id === session.session_id)) return prev;
      return [...prev, session].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    });
  }, []);

  return { sessions, loading, removeSession, restoreSession };
}

function useSessionSummaries(sessions: AnnotatedSession[]) {
  // Persisted summaries are derived directly from the session list so we
  // don't need a synchronous setState inside an effect to mirror them.
  const persistedSummaries = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of sessions) {
      if (s.summary_of_previous_context) {
        out[s.session_id] = s.summary_of_previous_context;
      }
    }
    return out;
  }, [sessions]);

  const [fetchedSummaries, setFetchedSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const session of sessions) {
      if (session.summary_of_previous_context) continue;

      // Trigger Haiku summary as soon as the session has had at least one
      // user+assistant exchange (matches ChatGPT's "title once first turn
      // completes" UX). The token-count proxy keeps us from spamming the LLM
      // for empty sessions; the backend also no-ops on empty transcripts.
      const hasFirstTurn =
        session.total_input_tokens > 0 && session.total_output_tokens > 0;
      if (!hasFirstTurn) continue;
      if (summarizingRef.current.has(session.session_id)) continue;

      summarizingRef.current.add(session.session_id);
      api
        .summarizeSession(session._projectId, session._agentInstanceId, session.session_id)
        .then((updated) => {
          if (updated.summary_of_previous_context) {
            setFetchedSummaries((prev) => ({
              ...prev,
              [session.session_id]: updated.summary_of_previous_context,
            }));
          }
        })
        .catch(() => {});
    }
  }, [sessions]);

  return useMemo(
    () => ({ ...fetchedSummaries, ...persistedSummaries }),
    [fetchedSummaries, persistedSummaries],
  );
}

type DateBucket = {
  label: string;
  sessions: AnnotatedSession[];
};

function bucketizeByDate(sessions: AnnotatedSession[]): DateBucket[] {
  const now = new Date();
  const order: string[] = [];
  const map = new Map<string, AnnotatedSession[]>();
  for (const session of sessions) {
    const bucket = getDateBucket(session.started_at, now);
    if (!map.has(bucket)) {
      map.set(bucket, []);
      order.push(bucket);
    }
    map.get(bucket)!.push(session);
  }
  return order.map((label) => ({ label, sessions: map.get(label)! }));
}

export function ChatsTab({
  agent,
  projectBindings,
}: {
  agent: Agent;
  projectBindings: ProjectBinding[];
}) {
  const { sessions, loading, removeSession, restoreSession } = useAgentSessions(
    agent.agent_id,
    projectBindings,
  );
  const summaries = useSessionSummaries(sessions);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const buckets = useMemo(() => bucketizeByDate(sessions), [sessions]);

  const resolveMenuTarget = useCallback(
    (nodeId: string): AnnotatedSession | null =>
      sessionById.get(nodeId) ?? null,
    [sessionById],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu<AnnotatedSession>({
      resolveItem: resolveMenuTarget,
    });

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || actionId !== "delete") return;
      removeSession(target.session_id);
      api
        .deleteSession(
          target._projectId,
          target._agentInstanceId,
          target.session_id,
        )
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(target);
        });
    },
    [menu, closeMenu, removeSession, restoreSession],
  );

  if (loading) {
    return <div className={styles.tabEmptyState}>Loading sessions...</div>;
  }

  if (sessions.length === 0) {
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <>
      <div className={styles.chatsList} onContextMenu={handleContextMenu}>
        {buckets.map((bucket) => (
          <section key={bucket.label} className={styles.chatsBucket}>
            <div className={styles.chatsBucketHeader}>{bucket.label}</div>
            {bucket.sessions.map((session) => {
              const summary = summaries[session.session_id];
              const hasSummary = Boolean(summary);
              const label = hasSummary ? truncate(summary, 80) : "New chat";
              return (
                <button
                  key={session.session_id}
                  type="button"
                  id={session.session_id}
                  className={`${styles.chatsRow} ${hasSummary ? "" : styles.chatsRowPlaceholder}`}
                  data-session-id={session.session_id}
                >
                  {label}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
          actions={["delete"]}
        />
      )}
    </>
  );
}
