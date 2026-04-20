import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, FileText, FolderClosed } from "lucide-react";
import type { ExplorerNode } from "@cypher-asi/zui";
import {
  buildLeftMenuEntries,
  LeftMenuTree,
  useLeftMenuExpandedGroups,
  useLeftMenuProjectReorder,
} from "../../../features/left-menu";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton/ProjectsPlusButton";
import { ExplorerContextMenu } from "../../../components/ProjectList/ExplorerContextMenu";
import { ProjectListModals } from "../../../components/ProjectList/ProjectListModals";
import { useProjectListActions } from "../../../hooks/use-project-list-actions";
import leftMenuStyles from "../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import styles from "./NotesNav.module.css";
import {
  useNotesStore,
  type NotesProjectTree,
} from "../../../stores/notes-store";
import type { NotesTreeNode } from "../../../api/notes";
import {
  folderIdFor,
  noteIdFor,
  parseNotesExplorerId,
  projectIdFor,
} from "./notes-explorer-ids";
import { NotesEntryContextMenu } from "../NotesEntryContextMenu";
import { NotesEntryModals } from "../NotesEntryModals";
import { useNotesContextMenu } from "./useNotesContextMenu";

function hoverPlusSuffix(onClick: () => void, title: string): ExplorerNode["suffix"] {
  return (
    <span className={leftMenuStyles.newChatWrap}>
      <ProjectsPlusButton
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }}
        title={title}
      />
    </span>
  );
}

function buildTreeNodes(
  projectId: string,
  nodes: NotesTreeNode[],
  titleOverrides: Record<string, string>,
  onCreateInFolder: (parentPath: string) => void,
): ExplorerNode[] {
  return nodes.map((node) => {
    if (node.kind === "folder") {
      return {
        id: folderIdFor(projectId, node.relPath),
        label: node.name,
        icon: <FolderClosed size={14} aria-hidden="true" />,
        metadata: { variant: "default", type: "folder" },
        suffix: hoverPlusSuffix(
          () => onCreateInFolder(node.relPath),
          `New note in ${node.name}`,
        ),
        children: buildTreeNodes(
          projectId,
          node.children,
          titleOverrides,
          onCreateInFolder,
        ),
      };
    }
    const override = titleOverrides[node.relPath];
    const displayLabel =
      (override && override.trim()) ||
      (node.title && node.title.trim()) ||
      node.name.replace(/\.md$/, "");
    return {
      id: noteIdFor(projectId, node.relPath),
      label: displayLabel,
      icon: <FileText size={14} aria-hidden="true" />,
      metadata: { type: "note" },
    };
  });
}

interface NotesNavProps {
  onCreateNote?: (projectId: string, parentPath: string) => void;
}

export function NotesNav({ onCreateNote }: NotesNavProps = {}) {
  const navigate = useNavigate();
  const projects = useProjectsListStore((s) => s.projects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const openNewProjectModal = useProjectsListStore((s) => s.openNewProjectModal);
  const refreshedOnce = useRef(false);

  const trees = useNotesStore((s) => s.trees);
  const loadTree = useNotesStore((s) => s.loadTree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const createNote = useNotesStore((s) => s.createNote);
  const activeRelPath = useNotesStore((s) => s.activeRelPath);
  const activeProjectId = useNotesStore((s) => s.activeProjectId);

  const { query: sidebarQuery, setAction } = useSidebarSearch("notes");

  const projectActions = useProjectListActions();
  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.project_id, p])),
    [projects],
  );
  const notesMenu = useNotesContextMenu({ projectActions, projectMap });

  useEffect(() => {
    if (!refreshedOnce.current && !loadingProjects && projects.length === 0) {
      refreshedOnce.current = true;
      void refreshProjects();
    }
  }, [projects.length, loadingProjects, refreshProjects]);

  useEffect(() => {
    for (const project of projects) {
      if (!trees[project.project_id]) {
        void loadTree(project.project_id);
      }
    }
  }, [projects, trees, loadTree]);

  const defaultExpandedIds = useMemo(() => {
    return projects.map((project) => projectIdFor(project.project_id));
  }, [projects]);

  const { expandedIds, toggleGroup } = useLeftMenuExpandedGroups(defaultExpandedIds);
  const expandedIdsSet = useMemo(() => new Set(expandedIds), [expandedIds]);

  const handleCreateNote = useCallback(
    (projectId: string, parentPath: string) => {
      if (onCreateNote) {
        onCreateNote(projectId, parentPath);
        return;
      }
      void createNote(projectId, parentPath).then((result) => {
        if (result) {
          navigate(`/notes/${projectId}/${encodeURIComponent(result.relPath)}`);
        }
      });
    },
    [createNote, navigate, onCreateNote],
  );

  const data = useMemo<ExplorerNode[]>(() => {
    return projects.map((project) => {
      const projectId = project.project_id;
      const tree: NotesProjectTree | undefined = trees[projectId];
      const children = tree
        ? buildTreeNodes(
            projectId,
            tree.nodes,
            tree.titleOverrides,
            (parentPath) => handleCreateNote(projectId, parentPath),
          )
        : [];
      return {
        id: projectIdFor(projectId),
        label: project.name,
        children,
        suffix: hoverPlusSuffix(
          () => handleCreateNote(projectId, ""),
          `New note in ${project.name}`,
        ),
        metadata: {
          variant: "default",
          type: "project",
        },
      };
    });
  }, [projects, trees, handleCreateNote]);

  useEffect(() => {
    setAction(
      "notes",
      <ProjectsPlusButton
        onClick={openNewProjectModal}
        title="New Project"
      />,
    );
    return () => setAction("notes", null);
  }, [openNewProjectModal, setAction]);

  const selectedLeafId = useMemo<string | null>(() => {
    if (!activeProjectId || !activeRelPath) return null;
    return noteIdFor(activeProjectId, activeRelPath);
  }, [activeProjectId, activeRelPath]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(data, {
        expandedIds: expandedIdsSet,
        onGroupActivate: (id) => {
          const parsed = parseNotesExplorerId(id);
          if (parsed?.kind === "project" || parsed?.kind === "folder") {
            toggleGroup(id);
          }
        },
        onGroupToggle: (id) => toggleGroup(id),
        groupToggleMode: "secondary",
        onItemSelect: (id) => {
          const parsed = parseNotesExplorerId(id);
          if (parsed?.kind === "note") {
            selectNote(parsed.projectId, parsed.relPath);
            navigate(
              `/notes/${parsed.projectId}/${encodeURIComponent(parsed.relPath)}`,
            );
          }
        },
        selectedNodeId: selectedLeafId,
        selectedGroupIds: new Set<string>(),
      }),
    [data, expandedIdsSet, selectedLeafId, toggleGroup, selectNote, navigate],
  );

  const resolveNotesProjectId = useCallback((entryId: string) => {
    const parsed = parseNotesExplorerId(entryId);
    return parsed?.kind === "project" ? parsed.projectId : null;
  }, []);
  const rootReorder = useLeftMenuProjectReorder(entries, {
    searchActive: sidebarQuery.trim().length > 0,
    resolveProjectId: resolveNotesProjectId,
  });

  return (
    <div className={styles.root}>
      {projects.length === 0 && !loadingProjects ? (
        <div className={styles.emptyState}>
          <ChevronRight size={14} aria-hidden="true" />
          Create a project first to start adding notes.
        </div>
      ) : (
        <LeftMenuTree
          ariaLabel="Notes navigation"
          entries={entries}
          onContextMenu={notesMenu.handleContextMenu}
          onKeyDown={notesMenu.handleKeyDown}
          rootReorder={rootReorder}
        />
      )}

      <ExplorerContextMenu actions={projectActions} />
      <ProjectListModals actions={projectActions} />
      <NotesEntryContextMenu actions={notesMenu} />
      <NotesEntryModals actions={notesMenu} />
    </div>
  );
}
