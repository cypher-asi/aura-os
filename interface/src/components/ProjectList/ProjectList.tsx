import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback } from "react";
import { PageEmptyState } from "@cypher-asi/zui";
import { FolderGit2 } from "lucide-react";
import { ListTree } from "../ListTree";
import { useProjectListData } from "./useProjectListData";
import { ProjectListModals } from "./ProjectListModals";
import { ExplorerContextMenu } from "./ExplorerContextMenu";
import { useProjectsExplorerModel } from "./project-list-projects-explorer";
import { api } from "../../api/client";
import { buildProjectSessionHistoryFetch } from "../../hooks/use-load-older-messages";
import {
  projectChatHistoryKey,
  sessionHistoryKey,
  useChatHistoryStore,
} from "../../stores/chat-history-store";
import {
  findMostRecentRealSessionForInstance,
  projectSessionsSurfaceKey,
  useSessionsListStore,
} from "../../stores/sessions-list-store";

import styles from "./ProjectList.module.css";

const explorerNodeStyles = {
  projectSuffix: styles.projectSuffix,
  newChatWrap: styles.newChatWrap,
  agentTrailing: styles.agentTrailing,
  agentStatusWrap: styles.agentStatusWrap,
  agentActionWrap: styles.agentActionWrap,
  agentActionButton: styles.agentActionButton,
  sessionIndicator: styles.sessionIndicator,
  automationSpinner: styles.automationSpinner,
  streamingDot: styles.streamingDot,
};

export function ProjectList() {
  const data = useProjectListData("projects");
  const explorer = useProjectsExplorerModel(data, explorerNodeStyles);

  // Pre-warm the chat-history-store entry for the destination chat
  // panel as the cursor enters an agent row in the project explorer.
  // Mirrors the agents-app `AgentList` hover prefetch — without it the
  // first render after the route change has `historyResolved=false` and
  // `ChatPanel`'s cold-load reveal cycle re-fires (overlay + brief
  // `visibility: hidden` on the message area).
  //
  // Delegated through the wrapping div so a single listener covers
  // every row; each `ListItem` row stamps the node id on its
  // `[data-list-item]` element, which we look up against the same
  // `agentMeta` map the click handler uses.
  const agentMeta = data.agentMeta;
  const projectMap = data.projectMap;
  const handleExplorerHover = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const row = target?.closest?.("[data-list-item][id]") as HTMLElement | null;
    if (!row) return;
    const meta = agentMeta.get(row.id);
    if (!meta) return;
    const { projectId } = meta;
    const agentInstanceId = row.id;
    // 1. Warm the no-session destination — covers the first frame of the
    //    project route while the default-session redirect is in flight.
    void useChatHistoryStore.getState().fetchHistory(
      projectChatHistoryKey(projectId, agentInstanceId),
      () => api.getEvents(projectId, agentInstanceId),
    );
    // 2. Warm the most-recent session's events — that is the slot the
    //    panel mounts on once `useDefaultProjectSessionRedirect` has
    //    rewritten `?session=`. Loading per-project sessions is
    //    idempotent and de-duped via per-surface request ids.
    const sessionsStore = useSessionsListStore.getState();
    const surfaceKey = projectSessionsSurfaceKey(projectId);
    const tryWarmRecent = () => {
      const list = useSessionsListStore.getState().sessionsBySurface[surfaceKey];
      if (!list || list.length === 0) return;
      const mostRecentForInstance = findMostRecentRealSessionForInstance(
        list,
        agentInstanceId,
      );
      if (!mostRecentForInstance) return;
      const key = sessionHistoryKey(
        mostRecentForInstance._projectId,
        mostRecentForInstance._agentInstanceId,
        mostRecentForInstance.session_id,
      );
      void useChatHistoryStore.getState().fetchHistory(
        key,
        buildProjectSessionHistoryFetch(
          mostRecentForInstance._projectId,
          mostRecentForInstance._agentInstanceId,
          mostRecentForInstance.session_id,
        ),
      );
    };
    if (sessionsStore.sessionsBySurface[surfaceKey] !== undefined) {
      tryWarmRecent();
      return;
    }
    const projectName = projectMap.get(projectId)?.name ?? "";
    void sessionsStore.loadProjectSessions(projectId, projectName).then(() => {
      tryWarmRecent();
    });
  }, [agentMeta, projectMap]);

  if (explorer.isEmptyState) {
    return (
      <div className={styles.root}>
        <PageEmptyState icon={<FolderGit2 size={32} />} title="No projects yet" description="Open an existing project or create a linked one from the desktop app." />
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div
        className={styles.explorerWrap}
        onContextMenu={explorer.handleContextMenu}
        onKeyDown={explorer.handleKeyDown}
        onMouseOver={handleExplorerHover}
      >
        <ListTree
          nodes={explorer.filteredExplorerData}
          indent={0}
          expandedIds={explorer.expandedIds}
          selectedId={explorer.defaultSelectedIds[0] ?? null}
          onSelect={(node) => explorer.handleSelect([node.id])}
          onExpand={explorer.handleExpand}
        />
      </div>

      <ExplorerContextMenu actions={explorer.actions} />
      <ProjectListModals actions={explorer.actions} />
    </div>
  );
}
