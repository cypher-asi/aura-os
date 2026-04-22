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
import {
  getCollapsedDebugProjects,
  setCollapsedDebugProjects,
} from "../../../utils/storage";
import {
  buildDebugExplorerData,
  buildRunningNowSection,
  RUNNING_NOW_GROUP_ID,
} from "./debug-nav-explorer-node";
import { useDebugRunsByProject } from "../useDebugRunsByProject";

const debugNavPersistence = {
  load: getCollapsedDebugProjects,
  save: setCollapsedDebugProjects,
};

function matchesSearch(text: string, needle: string): boolean {
  if (!needle) return true;
  return text.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Left menu for the Debug app. Every project owned by the workspace
 * appears at the top level (same as the Projects / Process apps) and
 * expands into its list of debug runs. Runs are fetched eagerly for
 * all projects so the "Running now" section (and per-project blue
 * dot) can surface in-progress runs without forcing the user to
 * manually expand every group.
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

  // Always fetch runs for every project so we can surface running
  // runs (see `runningNowSection` below) without requiring the user to
  // manually expand each project group. The query is deduped per
  // project by react-query, and `useDebugRunsByProject` only polls
  // at 3 s cadence for projects that currently contain a running run
  // (10 s otherwise).
  const allProjectIds = useMemo(
    () => filteredProjects.map((p) => p.project_id),
    [filteredProjects],
  );
  const { runsByProject, loadedProjectIds } =
    useDebugRunsByProject(allProjectIds);

  const runningRuns = useMemo(() => {
    const out: Array<{
      projectId: string;
      projectName: string;
      run: (typeof runsByProject)[string][number];
    }> = [];
    for (const project of filteredProjects) {
      const runs = runsByProject[project.project_id] ?? [];
      for (const run of runs) {
        if (run.status === "running") {
          out.push({
            projectId: project.project_id,
            projectName: project.name || project.project_id,
            run,
          });
        }
      }
    }
    return out;
  }, [filteredProjects, runsByProject]);

  const projectsWithRunningIds = useMemo(
    () =>
      Array.from(new Set(runningRuns.map((r) => r.projectId))),
    [runningRuns],
  );

  // Seed expansion with the currently-active project (if any), the
  // Running-now section, and any project that currently has a running
  // run so live runs are visible on mount without needing clicks. The
  // expanded-groups hook respects user-collapsed state, so users can
  // still collapse these after the run ends.
  const defaultExpandedIds = useMemo(() => {
    const ids = new Set<string>([RUNNING_NOW_GROUP_ID]);
    if (projectId) ids.add(projectId);
    for (const pid of projectsWithRunningIds) ids.add(pid);
    return Array.from(ids);
  }, [projectId, projectsWithRunningIds]);
  const { expandedIds, toggleGroup } = useLeftMenuExpandedGroups(
    defaultExpandedIds,
    { persistence: debugNavPersistence },
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

  const runningNowSection = useMemo(
    () => buildRunningNowSection(runningRuns),
    [runningRuns],
  );

  const handleSelect = useCallback(
    (nodeId: string) => {
      // Running-now items prefix their id with `__running__::` so they
      // can share the JSONL run ids without colliding with the normal
      // `${projectId}::${runId}` entries. Strip the prefix before
      // routing so both surfaces land on the same detail URL.
      const stripped = nodeId.startsWith("__running__::")
        ? nodeId.slice("__running__::".length)
        : nodeId;
      const [pid, rid] = stripped.split("::");
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

  // Prepend the "Running now" section so in-progress runs are the
  // first thing visible. We only include it when there is at least one
  // running run, to avoid a permanent empty header.
  const combinedExplorerData = useMemo(
    () =>
      runningNowSection ? [runningNowSection, ...explorerData] : explorerData,
    [runningNowSection, explorerData],
  );

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(combinedExplorerData, {
        expandedIds: new Set(expandedIds),
        selectedNodeId,
        searchActive: searchQuery.trim().length > 0,
        groupTestIdPrefix: "project",
        itemTestIdPrefix: "run",
        emptyTestIdPrefix: "empty",
        onGroupActivate: (id) => {
          // "Running now" is a presentation-only section; clicking
          // its header should just toggle expansion, not navigate.
          if (id === RUNNING_NOW_GROUP_ID) {
            toggleGroup(id);
            return;
          }
          toggleGroup(id);
          navigate(`/debug/${id}`);
        },
        onItemSelect: handleSelect,
      }),
    [
      combinedExplorerData,
      expandedIds,
      selectedNodeId,
      searchQuery,
      toggleGroup,
      navigate,
      handleSelect,
    ],
  );

  // `useLeftMenuProjectReorder` already excludes entries whose
  // underlying explorer node has `variant === "section"`, so the
  // "Running now" header we prepend above stays non-draggable.
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
