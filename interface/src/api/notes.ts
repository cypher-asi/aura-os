import { apiFetch } from "./core";

export interface NoteFrontmatter {
  created_at?: string;
  created_by?: string;
  updated_at?: string;
}

export interface NotesFolderNode {
  kind: "folder";
  name: string;
  relPath: string;
  children: NotesTreeNode[];
}

export interface NotesNoteNode {
  kind: "note";
  name: string;
  relPath: string;
  title: string;
  absPath: string;
  updatedAt?: string;
}

export type NotesTreeNode = NotesFolderNode | NotesNoteNode;

export interface NotesTreeResponse {
  nodes: NotesTreeNode[];
  root: string;
}

export interface NotesReadResponse {
  content: string;
  title: string;
  frontmatter: NoteFrontmatter;
  absPath: string;
  updatedAt?: string;
  wordCount: number;
}

export interface NotesWriteResponse {
  ok: boolean;
  title: string;
  /** Server-authoritative relative path after any title-driven rename. */
  relPath: string;
  /** Server-authoritative absolute path after any title-driven rename. */
  absPath: string;
  updatedAt: string;
  wordCount: number;
}

export interface NotesCreateResponse {
  relPath: string;
  title: string;
  absPath: string;
}

export interface NotesComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

function projectPath(projectId: string, suffix: string): string {
  return `/api/notes/projects/${encodeURIComponent(projectId)}${suffix}`;
}

export const notesApi = {
  tree: (projectId: string) =>
    apiFetch<NotesTreeResponse>(projectPath(projectId, "/tree")),

  read: (projectId: string, relPath: string) =>
    apiFetch<NotesReadResponse>(
      projectPath(projectId, `/read?path=${encodeURIComponent(relPath)}`),
    ),

  write: (projectId: string, relPath: string, content: string) =>
    apiFetch<NotesWriteResponse>(projectPath(projectId, "/write"), {
      method: "POST",
      body: JSON.stringify({ path: relPath, content }),
    }),

  create: (
    projectId: string,
    parentPath: string,
    name: string,
    kind: "note" | "folder",
  ) =>
    apiFetch<NotesCreateResponse>(projectPath(projectId, "/create"), {
      method: "POST",
      body: JSON.stringify({ parentPath, name, kind }),
    }),

  rename: (projectId: string, from: string, to: string) =>
    apiFetch<{ ok: boolean; relPath: string; absPath: string }>(
      projectPath(projectId, "/rename"),
      {
        method: "POST",
        body: JSON.stringify({ from, to }),
      },
    ),

  delete: (projectId: string, relPath: string) =>
    apiFetch<{ ok: boolean }>(projectPath(projectId, "/delete"), {
      method: "POST",
      body: JSON.stringify({ path: relPath }),
    }),

  listComments: (projectId: string, relPath: string) =>
    apiFetch<NotesComment[]>(
      projectPath(projectId, `/comments?path=${encodeURIComponent(relPath)}`),
    ),

  addComment: (
    projectId: string,
    relPath: string,
    body: string,
    authorName?: string,
  ) =>
    apiFetch<NotesComment>(projectPath(projectId, "/comments"), {
      method: "POST",
      body: JSON.stringify({ path: relPath, body, authorName }),
    }),

  deleteComment: (projectId: string, relPath: string, id: string) =>
    apiFetch<{ ok: boolean }>(projectPath(projectId, "/comments"), {
      method: "DELETE",
      body: JSON.stringify({ path: relPath, id }),
    }),
};
