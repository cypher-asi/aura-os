import { useMemo } from "react";
import { useSidekickStore } from "../../stores/sidekick-store";
import { useDelayedEmpty } from "../../hooks/use-delayed-empty";
import { filterExplorerNodes } from "../../utils/filterExplorerNodes";
import { Explorer } from "@cypher-asi/zui";
import type { ExplorerNode } from "@cypher-asi/zui";
import { StatusBadge } from "../../components/StatusBadge";
import { formatTokens } from "../../utils/format";
import { EmptyState } from "../../components/EmptyState";
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
  const { sessions, sessionById, loading, selectedId, setSelectedId } = useSessionListData();
  const viewSession = useSidekickStore((s) => s.viewSession);

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
                  {formatTokens(totalTokens)}
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
      viewSession(session);
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
    return <EmptyState>No sessions yet</EmptyState>;
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
