import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, FileText, FolderClosed } from "lucide-react";
import type { ExplorerNode } from "@cypher-asi/zui";
import {
  buildLeftMenuEntries,
  LeftMenuTree,
  useLeftMenuExpandedGroups,
} from "../../../features/left-menu";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidebarSearch } from "../../../hooks/use-sidebar-search";
import { ProjectsPlusButton } from "../../../components/ProjectsPlusButton/ProjectsPlusButton";
import leftMenuStyles from "../../../features/left-menu/LeftMenuTree/LeftMenuTree.module.css";
import {
  useNotesStore,
  type NotesProjectTree,
} from "../../../stores/notes-store";
import type { NotesTreeNode } from "../../../api/notes";

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

function noteIdFor(projectId: string, relPath: string): string {
  return `note::${projectId}::${relPath}`;
}

function folderIdFor(projectId: string, relPath: string): string {
  return `folder::${projectId}::${relPath}`;
}

function parseExplorerId(
  id: string,
): { kind: "project" | "note" | "folder"; projectId: string; relPath: string } | null {
  if (id.startsWith("note::")) {
    const body = id.slice("note::".length);
    const sep = body.indexOf("::");
    if (sep === -1) return null;
    return {
      kind: "note",
      projectId: body.slice(0, sep),
      relPath: body.slice(sep + 2),
    };
  }
  if (id.startsWith("folder::")) {
    const body = id.slice("folder::".length);
    const sep = body.indexOf("::");
    if (sep === -1) return null;
    return {
      kind: "folder",
      projectId: body.slice(0, sep),
      relPath: body.slice(sep + 2),
    };
  }
  if (id.startsWith("project::")) {
    return { kind: "project", projectId: id.slice("project::".length), relPath: "" };
  }
  return null;
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
  const params = useParams();
  const projects = useProjectsListStore((s) => s.projects);
  const loadingProjects = useProjectsListStore((s) => s.loadingProjects);
  const refreshProjects = useProjectsListStore((s) => s.refreshProjects);
  const refreshedOnce = useRef(false);

  const trees = useNotesStore((s) => s.trees);
  const loadTree = useNotesStore((s) => s.loadTree);
  const selectNote = useNotesStore((s) => s.selectNote);
  const createNote = useNotesStore((s) => s.createNote);
  const activeRelPath = useNotesStore((s) => s.activeRelPath);
  const activeProjectId = useNotesStore((s) => s.activeProjectId);

  const { setAction } = useSidebarSearch("notes");

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
    return projects.map((project) => `project::${project.project_id}`);
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
        id: `project::${projectId}`,
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
    const firstProject = projects[0];
    if (!firstProject) {
      setAction("notes", null);
      return;
    }
    const pid = (params.projectId as string | undefined) ?? activeProjectId ?? firstProject.project_id;
    setAction(
      "notes",
      <ProjectsPlusButton
        onClick={() => handleCreateNote(pid, "")}
        title="New Note"
      />,
    );
    return () => setAction("notes", null);
  }, [projects, params.projectId, activeProjectId, handleCreateNote, setAction]);

  const selectedLeafId = useMemo<string | null>(() => {
    if (!activeProjectId || !activeRelPath) return null;
    return noteIdFor(activeProjectId, activeRelPath);
  }, [activeProjectId, activeRelPath]);

  const entries = useMemo(
    () =>
      buildLeftMenuEntries(data, {
        expandedIds: expandedIdsSet,
        onGroupActivate: (id) => {
          const parsed = parseExplorerId(id);
          if (parsed?.kind === "project" || parsed?.kind === "folder") {
            toggleGroup(id);
          }
        },
        onGroupToggle: (id) => toggleGroup(id),
        groupToggleMode: "secondary",
        onItemSelect: (id) => {
          const parsed = parseExplorerId(id);
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

  return (
    <div style={{ height: "100%" }}>
      {projects.length === 0 && !loadingProjects ? (
        <div
          style={{
            padding: "24px 16px",
            color: "var(--color-text-secondary)",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <ChevronRight size={14} aria-hidden="true" />
          Create a project first to start adding notes.
        </div>
      ) : (
        <LeftMenuTree ariaLabel="Notes navigation" entries={entries} />
      )}
    </div>
  );
}
