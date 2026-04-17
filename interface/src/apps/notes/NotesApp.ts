import { FileText } from "lucide-react";
import { NotesNav } from "./NotesNav";
import { NotesMainPanel } from "./NotesMainPanel";
import { NotesSidekickPanel } from "./NotesSidekickPanel";
import { NotesSidekickTaskbar } from "./NotesSidekickTaskbar";
import type { AuraApp } from "../types";

export const NotesApp: AuraApp = {
  id: "notes",
  label: "Notes",
  icon: FileText,
  basePath: "/notes",
  LeftPanel: NotesNav,
  MainPanel: NotesMainPanel,
  ResponsiveControls: NotesNav,
  SidekickPanel: NotesSidekickPanel,
  SidekickTaskbar: NotesSidekickTaskbar,
};
