import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../../api/client";
import type { Session } from "../../types";
import { useProjectActions } from "../../stores/project-action-store";

interface SessionListData {
  sessions: Session[];
  sessionById: Map<string, Session>;
  loading: boolean;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
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

  return { sessions, sessionById, loading, selectedId, setSelectedId };
}
