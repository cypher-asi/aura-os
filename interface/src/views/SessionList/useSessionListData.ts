import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../api/client";
import type { Session } from "../../shared/types";
import { useProjectActions } from "../../stores/project-action-store";

interface SessionListData {
  sessions: Session[];
  sessionById: Map<string, Session>;
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  removeSession: (sessionId: string) => void;
  restoreSession: (session: Session) => void;
}

export function useSessionListData(): SessionListData {
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchSessions = useCallback(() => {
    if (!projectId) return;
    api.listProjectSessions(projectId)
      .then(setSessions)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const removeSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.session_id !== sessionId));
  }, []);

  const restoreSession = useCallback((session: Session) => {
    setSessions((prev) => {
      if (prev.some((s) => s.session_id === session.session_id)) return prev;
      return [...prev, session].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    });
  }, []);

  return {
    sessions,
    sessionById,
    loading,
    selectedId,
    setSelectedId,
    removeSession,
    restoreSession,
  };
}
