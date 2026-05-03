export * from "./notes-utils";
export type { TreeSlice } from "./notes-tree-slice";
export type { ContentSlice } from "./notes-content-slice";
export type { CommentsSlice } from "./notes-comments-slice";
export type { SidekickSlice } from "./notes-sidekick-slice";
export {
  useNotesStore,
  useActiveNote,
  useActiveNoteKey,
  useNotesTree,
  useNoteComments,
  type NotesStore,
} from "./notes-store";
