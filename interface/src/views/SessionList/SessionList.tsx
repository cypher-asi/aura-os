import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Explorer } from "@cypher-asi/zui";
import { useDelayedEmpty } from "../../shared/hooks/use-delayed-empty";
import { filterExplorerNodes } from "../../shared/utils/filterExplorerNodes";
import { EmptyState } from "../../components/EmptyState";
import { api } from "../../api/client";
import { useProjectActions } from "../../stores/project-action-store";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../components/SidekickItemContextMenu";
import type { Session } from "../../shared/types";
import { useSessionListData } from "./useSessionListData";
import styles from "../aura.module.css";

const SESSIONS_ROOT_ID = "__sessions_root__";

function truncate(text: string, max: number): string {
  const first = text.split("\n")[0].trim();
  if (first.length <= max) return first;
  return `${first.slice(0, max - 1)}…`;
}

export function SessionList({ searchQuery }: { searchQuery: string }) {
  const {
    sessions,
    sessionById,
    loading,
    selectedId,
    removeSession,
    restoreSession,
  } = useSessionListData();
  const ctx = useProjectActions();
  const projectId = ctx?.project.project_id;
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const summarizingRef = useRef<Set<string>>(new Set());

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

  const explorerData: ExplorerNode[] = useMemo(() => {
    const children: ExplorerNode[] = sessions.map((session, index) => {
      const number = sessions.length - index;
      const summary = summaries[session.session_id];
      const label = summary
        ? `S${number} · ${truncate(summary, 80)}`
        : `S${number}`;
      return {
        id: session.session_id,
        label,
        metadata: { type: "session" },
      };
    });

    return [
      {
        id: SESSIONS_ROOT_ID,
        label: "Sessions",
        children,
      },
    ];
  }, [sessions, summaries]);

  const filteredData = useMemo(
    () => filterExplorerNodes(explorerData, searchQuery),
    [explorerData, searchQuery],
  );

  const defaultExpandedIds = useMemo(() => [SESSIONS_ROOT_ID], []);
  const defaultSelectedIds = useMemo(
    () => (selectedId ? [selectedId] : []),
    [selectedId],
  );

  const resolveMenuTarget = useCallback(
    (nodeId: string): Session | null => sessionById.get(nodeId) ?? null,
    [sessionById],
  );
  const { menu, menuRef, handleContextMenu, closeMenu } =
    useSidekickItemContextMenu<Session>({ resolveItem: resolveMenuTarget });

  const handleMenuAction = useCallback(
    (actionId: string) => {
      const target = menu?.item;
      closeMenu();
      if (!target || actionId !== "delete" || !projectId) return;
      removeSession(target.session_id);
      api
        .deleteSession(projectId, target.agent_instance_id, target.session_id)
        .catch((err) => {
          console.error("Failed to delete session", err);
          restoreSession(target);
        });
    },
    [menu, closeMenu, projectId, removeSession, restoreSession],
  );

  const isEmpty = sessions.length === 0;
  const showEmpty = useDelayedEmpty(isEmpty, loading, 0);

  if (isEmpty) {
    if (!showEmpty) return null;
    return <EmptyState>No sessions yet</EmptyState>;
  }

  return (
    <>
      <div onContextMenu={handleContextMenu}>
        <Explorer
          data={filteredData}
          className={styles.taskExplorer}
          expandOnSelect
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          defaultSelectedIds={defaultSelectedIds}
        />
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
