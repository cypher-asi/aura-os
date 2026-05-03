import type {
  NoteFrontmatter,
  NotesTreeNode,
} from "../../shared/api/notes";

export const AUTOSAVE_DEBOUNCE_MS = 600;

export interface NoteKey {
  projectId: string;
  relPath: string;
}

export function makeNoteKey(projectId: string, relPath: string): string {
  return `${projectId}::${relPath}`;
}

export function parseNoteKey(key: string): NoteKey | null {
  const sepIndex = key.indexOf("::");
  if (sepIndex === -1) return null;
  return {
    projectId: key.slice(0, sepIndex),
    relPath: key.slice(sepIndex + 2),
  };
}

export function basename(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? relPath : relPath.slice(idx + 1);
}

export function isErrorWithStatus(err: unknown): err is { status: number } {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
  );
}

/**
 * Return a new nodes array with the note at `fromRelPath` renamed to
 * `toRelPath` (updating name/absPath/title/updatedAt). Returns the same
 * reference if no note matched, so callers can skip updating state.
 */
export function renameNoteInNodes(
  nodes: NotesTreeNode[],
  fromRelPath: string,
  toRelPath: string,
  nextAbsPath: string,
  nextTitle: string,
  nextUpdatedAt: string | undefined,
): NotesTreeNode[] {
  let changed = false;
  const next = nodes.map((node): NotesTreeNode => {
    if (node.kind === "folder") {
      const updatedChildren = renameNoteInNodes(
        node.children,
        fromRelPath,
        toRelPath,
        nextAbsPath,
        nextTitle,
        nextUpdatedAt,
      );
      if (updatedChildren !== node.children) {
        changed = true;
        return { ...node, children: updatedChildren };
      }
      return node;
    }
    if (node.relPath !== fromRelPath) return node;
    changed = true;
    return {
      ...node,
      relPath: toRelPath,
      name: basename(toRelPath),
      absPath: nextAbsPath,
      title: nextTitle,
      updatedAt: nextUpdatedAt ?? node.updatedAt,
    };
  });
  return changed ? next : nodes;
}

export interface NoteContent {
  content: string;
  title: string;
  frontmatter: NoteFrontmatter;
  absPath: string;
  updatedAt?: string;
  wordCount: number;
  /** Local-only draft that hasn't been flushed to disk yet. */
  dirty: boolean;
  /** Most recent autosave error, if any. */
  error?: string;
}

export interface NotesProjectTree {
  nodes: NotesTreeNode[];
  root: string;
  loading: boolean;
  error?: string;
  /** Local overrides for derived titles (driven by live edits to line 1). */
  titleOverrides: Record<string, string>;
}

export function emptyProjectTree(): NotesProjectTree {
  return { nodes: [], root: "", loading: true, titleOverrides: {} };
}

/** Extract a display title from the first non-empty line of markdown content. */
export function extractTitleFromContent(content: string): string {
  const lines = content.split(/\r?\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    i = 1;
    while (i < lines.length && lines[i]?.trim() !== "---") i += 1;
    if (i < lines.length) i += 1;
  }
  for (; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (!trimmed) continue;
    return trimmed.replace(/^#+\s*/, "").trim();
  }
  return "";
}

export function countWords(body: string): number {
  return body
    .replace(/^---[\s\S]*?---/, "")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Per-note debounce timers shared by the content slice's autosave path.
 * Lives at module scope so successive calls collapse onto the same
 * timer key, and so a rename operation can transplant a pending timer
 * onto the new key without losing the in-flight write.
 */
export const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function schedulePersist(
  key: string,
  run: () => void,
): void {
  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    run();
  }, AUTOSAVE_DEBOUNCE_MS);
  pendingTimers.set(key, timer);
}

/** Returns ms timeout so tests can override the debounce. */
export const NOTES_AUTOSAVE_DEBOUNCE_MS = AUTOSAVE_DEBOUNCE_MS;
