import {
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ButtonPlus } from "@cypher-asi/zui";
import { useSidebarSearch } from "../../../../hooks/use-sidebar-search";
import type { CtxMenuState, DeleteProjectTarget, RenameTargetExt } from "./process-list-types";

function useDismissOnOutsideClick(
  ref: RefObject<HTMLDivElement | null>,
  active: boolean,
  onClose: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [active, onClose, ref]);
}

export function useProcessListUiState(): {
  addMenuAnchor: { x: number; y: number } | null;
  addMenuRef: RefObject<HTMLDivElement | null>;
  ctxMenu: CtxMenuState | null;
  ctxMenuRef: RefObject<HTMLDivElement | null>;
  deleteProjectError: string | null;
  deleteProjectLoading: boolean;
  deleteProjectTarget: DeleteProjectTarget;
  pendingSelectId: string | null;
  processFormProjectId: string | null;
  renameTarget: RenameTargetExt | null;
  setAddMenuAnchor: (value: { x: number; y: number } | null) => void;
  setCtxMenu: (value: CtxMenuState | null) => void;
  setDeleteProjectError: (value: string | null) => void;
  setDeleteProjectLoading: (value: boolean) => void;
  setDeleteProjectTarget: (value: DeleteProjectTarget) => void;
  setPendingSelectId: (value: string | null) => void;
  setProcessFormProjectId: (value: string | null) => void;
  setRenameTarget: (value: RenameTargetExt | null) => void;
  setShowProcessForm: (value: boolean) => void;
  showProcessForm: boolean;
} {
  const [showProcessForm, setShowProcessForm] = useState(false);
  const [processFormProjectId, setProcessFormProjectId] = useState<string | null>(null);
  const [addMenuAnchor, setAddMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTargetExt | null>(null);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<DeleteProjectTarget>(null);
  const [deleteProjectLoading, setDeleteProjectLoading] = useState(false);
  const [deleteProjectError, setDeleteProjectError] = useState<string | null>(null);
  const [pendingSelectId, setPendingSelectId] = useState<string | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutsideClick(ctxMenuRef, Boolean(ctxMenu), () => setCtxMenu(null));
  useDismissOnOutsideClick(addMenuRef, Boolean(addMenuAnchor), () => setAddMenuAnchor(null));

  return {
    addMenuAnchor,
    addMenuRef,
    ctxMenu,
    ctxMenuRef,
    deleteProjectError,
    deleteProjectLoading,
    deleteProjectTarget,
    pendingSelectId,
    processFormProjectId,
    renameTarget,
    setAddMenuAnchor,
    setCtxMenu,
    setDeleteProjectError,
    setDeleteProjectLoading,
    setDeleteProjectTarget,
    setPendingSelectId,
    setProcessFormProjectId,
    setRenameTarget,
    setShowProcessForm,
    showProcessForm,
  };
}

export function useProcessSidebarAction(
  setAddMenuAnchor: (value: { x: number; y: number } | null) => void,
): void {
  const { setAction } = useSidebarSearch("process");

  useEffect(() => {
    setAction(
      "process",
      <ButtonPlus
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setAddMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
        }}
        size="sm"
        title="New Process"
      />,
    );
    return () => setAction("process", null);
  }, [setAction, setAddMenuAnchor]);
}
