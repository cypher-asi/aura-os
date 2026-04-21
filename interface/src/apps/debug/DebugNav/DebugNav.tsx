import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Bug } from "lucide-react";
import { PageEmptyState } from "@cypher-asi/zui";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import {
  LeftMenuTree,
  buildLeftMenuEntries,
  useLeftMenuExpandedGroups,
  useLeftMenuProjectReorder,
} from "../../../features/left-menu";
import treeStyles from "../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import { buildDebugExplorerData } from "./debug-nav-explorer-node";
import { useDebugRunsByProject } from "../useDebugRunsByProject";

function matchesSearch(text: string, needle: string): boolean {
  if (!needle) return true;
  return text.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Left menu for the Debug app. Every project owned by the workspace
 * appears at the top level (same as the Projects / Process apps) and
 * expands into its list of debug runs. Runs are lazy-fetched when a
 * project group is expanded, so projects without recorded runs don't
 * trigger network calls on mount.
 */
export function DebugNav() {
  const navigate = useNavigate();
  const { projectId, runId } = useParams<{ projectId?: string; runId?: string }>();
  const projects = useProjectsListStore((s) => s.projects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const { query: searchQuery } = useSidebarSearch("debug");

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects;
    const needle = searchQuery.trim();
    return projects.filter(
      (project) =>
        matchesSearch(project.name, needle) ||
        matchesSearch(project.project_id, needle),
    );
  }, [projects, searchQuery]);

  const defaultExpandedIds = useMemo(
    () => (projectId ? [projectId] : []),
    [projectId],
  );
  const { expandedIds, toggleGroup } = useLeftMenuExpandedGroups(
    defaultExpandedIds,
  );

  const expandedProjectIds = useMemo(
    () =>
      filteredProjects
        .map((project) => project.project_id)
        .filter((id) => expandedIds.includes(id)),
    [filteredProjects, expandedIds],
  );

  const { runsByProject, loadedProjectIds } = useDebugRunsByProject(
    expandedProjectIds,
  );

  const explorerData = useMemo(
    () =>
      buildDebugExplorerData({
        projects: filteredProjects.map((project) => ({
          project_id: project.project_id,
          name: project.name,
        })),
        runsByProject,
        loadedProjectIds,
      }),
    [filteredProjects, runsByProject, loadedProjectIds],
  );

  const handleSelect = useCallback(
    (nodeId: string) => {
      const [pid, rid] = nodeId.split("::");
      if (!pid) return;
      if (rid && !rid.startsWith("__")) {
        navigate(`/debug/${pid}/runs/${rid}`);
      } else {
        navigate(`/debug/${pid}`);
      }
    },
    [navigate],
  );

  const selectedNodeId = runId && projectId ? `${projectId}::${runId}` : null;

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(explorerData, {
        expandedIds: new Set(expandedIds),
        selectedNodeId,
        searchActive: searchQuery.trim().length > 0,
        groupTestIdPrefix: "project",
        itemTestIdPrefix: "run",
        emptyTestIdPrefix: "empty",
        onGroupActivate: (id) => {
          toggleGroup(id);
          navigate(`/debug/${id}`);
        },
        onItemSelect: handleSelect,
      }),
    [
      explorerData,
      expandedIds,
      selectedNodeId,
      searchQuery,
      toggleGroup,
      navigate,
      handleSelect,
    ],
  );

  const rootReorder = useLeftMenuProjectReorder(entries, {
    searchActive: searchQuery.trim().length > 0,
  });

  const isEmptyState = !loadingProjects && projects.length === 0;

  if (isEmptyState) {
    return (
      <div className={treeStyles.root}>
        <PageEmptyState
          icon={<Bug size={32} />}
          title="No projects yet"
          description="Create a project to start capturing debug runs."
        />
      </div>
    );
  }

  return (
    <div className={treeStyles.root}>
      <LeftMenuTree
        ariaLabel="Debug projects"
        entries={entries}
        rootReorder={rootReorder}
      />
    </div>
  );
}
