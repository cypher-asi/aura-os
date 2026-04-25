import { useCallback } from "react";
import type { Project, AgentInstance } from "../../shared/types";
import type { useProjectListActions } from "../../hooks/use-project-list-actions";

type Actions = ReturnType<typeof useProjectListActions>;

export function useExplorerMenus(
  projectMap: Map<string, Project>,
  agentMeta: Map<string, { projectId: string; agent: AgentInstance }>,
  actions: Actions,
) {
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest("button[id]");
    if (!target) return;
    const nodeId = target.id;
    const proj = projectMap.get(nodeId);
    if (proj) { e.preventDefault(); actions.setCtxMenu({ x: e.clientX, y: e.clientY, project: proj }); return; }
    const meta = agentMeta.get(nodeId);
    if (meta) { e.preventDefault(); actions.setCtxMenu({ x: e.clientX, y: e.clientY, agent: meta.agent }); }
  }, [projectMap, agentMeta, actions]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "F2") return;
    const focused = (e.target as HTMLElement).closest("button[id]");
    if (!focused) return;
    const proj = projectMap.get(focused.id);
    if (proj) { e.preventDefault(); actions.setRenameTarget(proj); return; }
    const meta = agentMeta.get(focused.id);
    if (meta) { e.preventDefault(); actions.setRenameAgentTarget(meta.agent); }
  }, [projectMap, agentMeta, actions]);

  return { handleContextMenu, handleKeyDown };
}
