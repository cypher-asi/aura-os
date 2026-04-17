import { useCallback, useState } from "react";
import { api } from "../api/client";
import { useSidekickStore } from "../stores/sidekick-store";
import type { ProjectId, Spec } from "../types";
import { getApiErrorDetails, getApiErrorMessage } from "../utils/api-errors";

export interface UseDeleteSpecResult {
  deleteTarget: Spec | null;
  setDeleteTarget: (spec: Spec | null) => void;
  deleteLoading: boolean;
  deleteError: string | null;
  setDeleteError: (err: string | null) => void;
  handleDelete: () => Promise<void>;
  closeDeleteModal: () => void;
}

/**
 * Shared state + handler for deleting a spec from a list view.
 *
 * Deletion is NOT optimistic: the spec stays in the tree until the server
 * confirms a successful delete, so server-side conflicts (e.g. the spec still
 * has associated tasks) can be surfaced inline in the modal without needing
 * to roll back UI state.
 */
export function useDeleteSpec(projectId: ProjectId | undefined): UseDeleteSpecResult {
  const [deleteTarget, setDeleteTarget] = useState<Spec | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !projectId) return;
    const spec = deleteTarget;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.deleteSpec(projectId, spec.spec_id);
      useSidekickStore.getState().removeSpec(spec.spec_id);
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete spec", err);
      const message = getApiErrorMessage(err);
      const details = getApiErrorDetails(err);
      setDeleteError(details ? `${message} ${details}` : message);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, projectId]);

  return {
    deleteTarget,
    setDeleteTarget,
    deleteLoading,
    deleteError,
    setDeleteError,
    handleDelete,
    closeDeleteModal,
  };
}
