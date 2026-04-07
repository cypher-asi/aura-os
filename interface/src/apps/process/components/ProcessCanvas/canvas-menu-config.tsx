import type { MenuItem } from "@cypher-asi/zui";
import {
  Play,
  GitBranch,
  FileOutput,
  Timer,
  Merge,
  Pencil,
  Trash2,
  Pin,
  PinOff,
  MessageSquare,
  Workflow,
  Repeat,
  Layers,
  Unplug,
  Copy,
  Scissors,
  CopyPlus,
} from "lucide-react";
import { ADD_NODE_TYPES } from "./process-canvas-utils";

export const NODE_MENU_ICONS: Record<string, React.ReactNode> = {
  prompt: <MessageSquare size={14} />,
  action: <Play size={14} />,
  condition: <GitBranch size={14} />,
  artifact: <FileOutput size={14} />,
  delay: <Timer size={14} />,
  merge: <Merge size={14} />,
  sub_process: <Workflow size={14} />,
  for_each: <Repeat size={14} />,
  group: <Layers size={14} />,
};

export const nodeMenuItems: MenuItem[] = ADD_NODE_TYPES.map((item) => ({
  id: item.type,
  label: item.label,
  icon: NODE_MENU_ICONS[item.type],
}));

export const groupCtxMenuItems: MenuItem[] = [
  { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
  { id: "copy", label: "Copy", icon: <Copy size={14} /> },
  { id: "cut", label: "Cut", icon: <Scissors size={14} /> },
  { id: "duplicate", label: "Duplicate", icon: <CopyPlus size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

export function nodeCtxMenuItems(
  isIgnition: boolean,
  isPinned: boolean,
  hasRuns: boolean,
  hasConnections: boolean,
): MenuItem[] {
  return [
    { id: "rename", label: "Rename", icon: <Pencil size={14} /> },
    { id: "copy", label: "Copy", icon: <Copy size={14} /> },
    { id: "cut", label: "Cut", icon: <Scissors size={14} />, disabled: isIgnition },
    { id: "duplicate", label: "Duplicate", icon: <CopyPlus size={14} />, disabled: isIgnition },
    { type: "separator" as const },
    isPinned
      ? { id: "unpin", label: "Unpin Output", icon: <PinOff size={14} /> }
      : { id: "pin", label: "Pin Output", icon: <Pin size={14} />, disabled: !hasRuns },
    { id: "disconnect", label: "Disconnect", icon: <Unplug size={14} />, disabled: !hasConnections },
    { type: "separator" as const },
    { id: "delete", label: "Delete", icon: <Trash2 size={14} />, disabled: isIgnition },
  ];
}

export const selectionCtxMenuItems: MenuItem[] = [
  { id: "copy", label: "Copy", icon: <Copy size={14} /> },
  { id: "cut", label: "Cut", icon: <Scissors size={14} /> },
  { id: "duplicate", label: "Duplicate", icon: <CopyPlus size={14} /> },
  { type: "separator" },
  { id: "delete", label: "Delete", icon: <Trash2 size={14} /> },
];

export function findAddNodeType(type: string) {
  return ADD_NODE_TYPES.find((t) => t.type === type);
}
