import type { Dispatch, RefObject, SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { Edge } from "@xyflow/react";
import { Trash2, ClipboardPaste } from "lucide-react";
import { Menu, ModalConfirm } from "@cypher-asi/zui";
import type { ProcessNodeType } from "../../../../shared/types/enums";
import type { ProcessNode, ProcessRun } from "../../../../shared/types";
import {
  nodeMenuItems,
  groupCtxMenuItems,
  nodeCtxMenuItems,
  selectionCtxMenuItems,
  findAddNodeType,
} from "./canvas-menu-config";

export function ProcessCanvasContextMenus(props: {
  processNodes: ProcessNode[];
  runs: ProcessRun[];
  edges: Edge[];
  hasClipboard: boolean;
  ctxMenu: { x: number; y: number } | null;
  nodeCtxMenu: { x: number; y: number; nodeId: string } | null;
  edgeCtxMenu: { x: number; y: number; edgeId: string } | null;
  selectionCtxMenu: { x: number; y: number; nodeIds: string[] } | null;
  ctxMenuRef: RefObject<HTMLDivElement | null>;
  nodeCtxMenuRef: RefObject<HTMLDivElement | null>;
  edgeCtxMenuRef: RefObject<HTMLDivElement | null>;
  selectionCtxMenuRef: RefObject<HTMLDivElement | null>;
  setCtxMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
  setNodeCtxMenu: Dispatch<SetStateAction<{ x: number; y: number; nodeId: string } | null>>;
  setEdgeCtxMenu: Dispatch<SetStateAction<{ x: number; y: number; edgeId: string } | null>>;
  setSelectionCtxMenu: Dispatch<SetStateAction<{ x: number; y: number; nodeIds: string[] } | null>>;
  setRenamingNodeId: (id: string | null) => void;
  pasteNodes: (pos: { x: number; y: number }) => void;
  handleAddNode: (type: ProcessNodeType, label: string) => void;
  copyNodes: (ids: string[]) => void;
  deleteNodes: (ids: string[]) => void;
  duplicateNodes: (ids: string[]) => void;
  requestDeleteNodes: (ids: string[]) => void;
  togglePinNode: (id: string) => void;
  disconnectNode: (id: string) => void;
  deleteConnection: (edgeId: string) => void;
  pendingDeleteNodeIds: string[] | null;
  confirmDeleteNodes: () => void;
  cancelDeleteNodes: () => void;
}) {
  const {
    processNodes,
    runs,
    edges,
    hasClipboard,
    ctxMenu,
    nodeCtxMenu,
    edgeCtxMenu,
    selectionCtxMenu,
    ctxMenuRef,
    nodeCtxMenuRef,
    edgeCtxMenuRef,
    selectionCtxMenuRef,
    setCtxMenu,
    setNodeCtxMenu,
    setEdgeCtxMenu,
    setSelectionCtxMenu,
    setRenamingNodeId,
    pasteNodes,
    handleAddNode,
    copyNodes,
    deleteNodes,
    duplicateNodes,
    requestDeleteNodes,
    togglePinNode,
    disconnectNode,
    deleteConnection,
    pendingDeleteNodeIds,
    confirmDeleteNodes,
    cancelDeleteNodes,
  } = props;

  return (
    <>
      {ctxMenu && createPortal(
        <div
          ref={ctxMenuRef}
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={[
              ...(hasClipboard
                ? [
                  { id: "paste" as const, label: "Paste", icon: <ClipboardPaste size={14} /> },
                  { type: "separator" as const },
                ]
                : []),
              ...nodeMenuItems,
            ]}
            onChange={(id) => {
              if (id === "paste") {
                if (ctxMenu) pasteNodes({ x: ctxMenu.x, y: ctxMenu.y });
                setCtxMenu(null);
                return;
              }
              const item = findAddNodeType(String(id));
              if (item) handleAddNode(item.type as ProcessNodeType, item.label);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={180}
            isOpen
          />
        </div>,
        document.body,
      )}

      {nodeCtxMenu && createPortal(
        <div
          ref={nodeCtxMenuRef}
          style={{ position: "fixed", left: nodeCtxMenu.x, top: nodeCtxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={(() => {
              const node = processNodes.find((n) => n.node_id === nodeCtxMenu.nodeId);
              if (node?.node_type === "group") return groupCtxMenuItems;
              const hasConnections = edges.some(
                (e) => e.source === nodeCtxMenu.nodeId || e.target === nodeCtxMenu.nodeId,
              );
              return nodeCtxMenuItems(
                node?.node_type === "ignition",
                !!node?.config?.pinned_output,
                runs.length > 0,
                hasConnections,
              );
            })()}
            onChange={(id) => {
              const targetId = nodeCtxMenu.nodeId;
              setNodeCtxMenu(null);
              if (id === "rename") setRenamingNodeId(targetId);
              if (id === "copy") copyNodes([targetId]);
              if (id === "cut") { copyNodes([targetId]); deleteNodes([targetId]); }
              if (id === "duplicate") duplicateNodes([targetId]);
              if (id === "pin" || id === "unpin") togglePinNode(targetId);
              if (id === "disconnect") disconnectNode(targetId);
              if (id === "delete") requestDeleteNodes([targetId]);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={160}
            isOpen
          />
        </div>,
        document.body,
      )}

      {edgeCtxMenu && createPortal(
        <div
          ref={edgeCtxMenuRef}
          style={{ position: "fixed", left: edgeCtxMenu.x, top: edgeCtxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={[{ id: "delete", label: "Delete connection", icon: <Trash2 size={14} /> }]}
            onChange={(id) => {
              if (id === "delete") deleteConnection(edgeCtxMenu.edgeId);
              setEdgeCtxMenu(null);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={180}
            isOpen
          />
        </div>,
        document.body,
      )}

      {selectionCtxMenu && createPortal(
        <div
          ref={selectionCtxMenuRef}
          style={{ position: "fixed", left: selectionCtxMenu.x, top: selectionCtxMenu.y, zIndex: 9999 }}
        >
          <Menu
            items={selectionCtxMenuItems}
            onChange={(id) => {
              const nodeIds = selectionCtxMenu.nodeIds;
              setSelectionCtxMenu(null);
              if (id === "copy") copyNodes(nodeIds);
              if (id === "cut") { copyNodes(nodeIds); deleteNodes(nodeIds); }
              if (id === "duplicate") duplicateNodes(nodeIds);
              if (id === "delete") requestDeleteNodes(nodeIds);
            }}
            background="solid"
            border="solid"
            rounded="md"
            width={160}
            isOpen
          />
        </div>,
        document.body,
      )}

      <ModalConfirm
        isOpen={pendingDeleteNodeIds !== null && pendingDeleteNodeIds.length > 0}
        onClose={cancelDeleteNodes}
        onConfirm={confirmDeleteNodes}
        title={pendingDeleteNodeIds && pendingDeleteNodeIds.length > 1 ? "Delete Nodes" : "Delete Node"}
        message={
          pendingDeleteNodeIds && pendingDeleteNodeIds.length > 1
            ? `Are you sure you want to delete these ${pendingDeleteNodeIds.length} nodes? This action cannot be undone.`
            : "Are you sure you want to delete this node? This action cannot be undone."
        }
        confirmLabel="Delete"
        danger
      />
    </>
  );
}
