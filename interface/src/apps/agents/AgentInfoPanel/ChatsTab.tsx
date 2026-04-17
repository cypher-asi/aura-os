import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ExplorerNode } from "@cypher-asi/zui";
import { Explorer } from "@cypher-asi/zui";
import { EmptyState } from "../../../components/EmptyState";
import { TaskStatusIcon } from "../../../components/TaskStatusIcon";
import { api } from "../../../api/client";
import { type AnnotatedSession } from "./agent-info-utils";
import {
  SidekickItemContextMenu,
  useSidekickItemContextMenu,
} from "../../../components/SidekickItemContextMenu";
import type { ExplorerNodeWithSuffix } from "../../../lib/zui-compat";
import type { Agent } from "../../../types";
import { displaySessionStatus } from "../../../views/SessionList/displaySessionStatus";
import viewStyles from "../../../views/aura.module.css";
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

  return summaries;
}

export function ChatsTab({
  agent,
  projectBindings,
}: {
  agent: Agent;
  projectBindings: ProjectBinding[];
}) {
  const navigate = useNavigate();
  const { sessions, loading, removeSession, restoreSession } = useAgentSessions(
    agent.agent_id,
    projectBindings,
  );
  const summaries = useSessionSummaries(sessions);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.session_id, s])),
    [sessions],
  );

  const explorerData: ExplorerNode[] = useMemo(() => {
    const byProject = new Map<string, AnnotatedSession[]>();
    for (const session of sessions) {
      const list = byProject.get(session._projectId) ?? [];
      list.push(session);
      byProject.set(session._projectId, list);
    }

    const groups: ExplorerNodeWithSuffix[] = [];
    for (const [projectId, list] of byProject) {
      const projectName = list[0]?._projectName ?? "Project";
      const children: ExplorerNodeWithSuffix[] = list.map((session, index) => {
        const number = list.length - index;
        const summary = summaries[session.session_id];
        const label = summary
          ? `S${number} · ${truncate(summary, 80)}`
          : `S${number}`;
        const status = displaySessionStatus(session.status, index === 0);
        return {
          id: session.session_id,
          label,
          suffix: <TaskStatusIcon status={status} />,
          metadata: { type: "session" },
        };
      });
      groups.push({
        id: `__project_${projectId}__`,
        label: projectName,
        children,
      });
    }
    return groups;
  }, [sessions, summaries]);

  const defaultExpandedIds = useMemo(
    () => explorerData.map((n) => n.id),
    [explorerData],
  );

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
      <div onContextMenu={handleContextMenu}>
        <Explorer
          data={explorerData}
          className={viewStyles.taskExplorer}
          expandOnSelect
          enableDragDrop={false}
          enableMultiSelect={false}
          defaultExpandedIds={defaultExpandedIds}
          onSelect={(ids) => {
            const id = [...ids].reverse().find((candidate) =>
              sessionById.has(candidate),
            );
            if (!id) return;
            const session = sessionById.get(id);
            if (!session) return;
            navigate(
              `/projects/${session._projectId}/agents/${session._agentInstanceId}?session=${session.session_id}`,
            );
          }}
        />
      </div>
      {menu && (
        <SidekickItemContextMenu
          x={menu.x}
          y={menu.y}
          menuRef={menuRef}
          onAction={handleMenuAction}
        />
      )}
    </>
  );
}
