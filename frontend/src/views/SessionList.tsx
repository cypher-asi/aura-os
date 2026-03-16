import { useEffect, useState, useCallback, useMemo } from "react";
import { api } from "../api/client";
import type { Session } from "../types";
import { useSidekick } from "../context/SidekickContext";
import { useProjectContext } from "../context/ProjectContext";
import { useDelayedEmpty } from "../hooks/use-delayed-empty";
import { filterExplorerNodes } from "../utils/filterExplorerNodes";
import { Explorer, PageEmptyState } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { MonitorCog } from "lucide-react";
import { StatusBadge } from "../components/StatusBadge";
import { formatCostFromTokens } from "../utils/pricing";
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
  const ctx = useProjectContext();
  const projectId = ctx?.project.project_id;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sidekick = useSidekick();

  const fetchSessions = useCallback(() => {
    if (!projectId) return;
    api
      .listProjectSessions(projectId)
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

  const explorerData: ExplorerNode[] = useMemo(
    () =>
      sessions.map((session, index) => {
        const totalTokens = session.total_input_tokens + session.total_output_tokens;
        return {
          id: session.session_id,
          label: `s.${sessions.length - index}`,
          icon: <StatusBadge status={session.status} />,
          suffix: (
            <span className={styles.sessionMeta}>
              <span className={styles.sessionDuration}>
                {formatDuration(session.started_at, session.ended_at)}
              </span>
              {totalTokens > 0 && (
                <span className={styles.sessionCost}>
                  {formatCostFromTokens(session.total_input_tokens, session.total_output_tokens, session.model ?? undefined)}
                </span>
              )}
            </span>
          ),
          metadata: { type: "session" },
        };
      }),
    [sessions],
  );

  const handleSelect = (ids: string[]) => {
    const id = ids[0];
    if (!id) return;
    const session = sessionById.get(id);
    if (session) {
      setSelectedId(id);
      sidekick.viewSession(session);
    }
  };

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const isEmpty = sessions.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return (
      <div className={styles.emptyWrap}>
        <PageEmptyState
          icon={<MonitorCog size={32} />}
          title="No sessions yet"
          description="Sessions will appear here once the agent starts working."
        />
      </div>
    );
  }

  return (
    <div className={styles.sessionListWrap}>
      <Explorer
        data={filteredData}
        enableMultiSelect={false}
        defaultSelectedIds={selectedId ? [selectedId] : undefined}
        onSelect={handleSelect}
      />
    </div>
  );
}
