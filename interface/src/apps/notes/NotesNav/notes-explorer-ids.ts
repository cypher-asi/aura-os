type NotesExplorerKind = "project" | "folder" | "note";

interface ParsedNotesExplorerId {
  kind: NotesExplorerKind;
  projectId: string;
  relPath: string;
}

export function noteIdFor(projectId: string, relPath: string): string {
  return `note::${projectId}::${relPath}`;
}

export function folderIdFor(projectId: string, relPath: string): string {
  return `folder::${projectId}::${relPath}`;
}

export function projectIdFor(projectId: string): string {
  return `project::${projectId}`;
}

export function parseNotesExplorerId(id: string): ParsedNotesExplorerId | null {
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
    return {
      kind: "project",
      projectId: id.slice("project::".length),
      relPath: "",
    };
  }
  return null;
}

/** Replace the last segment of `relPath` with `name`, preserving `.md` for notes. */
export function renameRelPath(
  relPath: string,
  name: string,
  kind: "note" | "folder",
): string {
  const trimmed = name.trim();
  const segments = relPath.split("/");
  segments.pop();
  const finalName =
    kind === "note" && !/\.md$/i.test(trimmed) ? `${trimmed}.md` : trimmed;
  return [...segments, finalName].filter(Boolean).join("/");
}

/** The parent folder relPath (or `""` for the project root). */
export function parentRelPath(relPath: string): string {
  const idx = relPath.lastIndexOf("/");
  return idx === -1 ? "" : relPath.slice(0, idx);
}

/** The last segment (display name without extension for notes). */
export function leafName(relPath: string, kind: "note" | "folder"): string {
  const last = relPath.split("/").pop() ?? "";
  return kind === "note" ? last.replace(/\.md$/i, "") : last;
}
