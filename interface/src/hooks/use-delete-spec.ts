import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useSidekickStore } from "../stores/sidekick-store";
import {
  projectQueryKeys,
  removeSpecFromProjectLayout,
  type ProjectLayoutBundle,
} from "../queries/project-queries";
import type { ProjectId, Spec } from "../shared/types";
import { getApiErrorDetails, getApiErrorMessage } from "../shared/utils/api-errors";

export interface UseDeleteSpecResult {
  deleteTarget: Spec | null;
  setDeleteTarget: (spec: Spec | null) => void;
  deleteLoading: boolean;
  deleteError: string | null;
  setDeleteError: (err: string | null) => void;
  handleDelete: () => Promise<void>;
  closeDeleteModal: () => void;
}

/** Detect optimistic placeholders pushed by `pushPendingSpec` while a
 *  `create_spec` tool call is still streaming. The id is intentionally
 *  not a UUID (it's `pending-<tool_use_id>`) so it can never collide
 *  with a real backend spec, but it also can't be DELETEd because the
 *  backend `Path<SpecId>` extractor rejects non-UUID path segments. */
export function isPendingSpecId(id: string): boolean {
  return id.startsWith("pending-");
}

// RFC 4122 UUID (any version). Matches the backend `SpecId::from_str`
// validation so we can short-circuit obviously-invalid deletes before
// they hit the network and get back an opaque 400 "Bad Request".
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(id: string): boolean {
  return UUID_RE.test(id);
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
  const queryClient = useQueryClient();

  const closeDeleteModal = useCallback(() => {
    setDeleteTarget(null);
    setDeleteError(null);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget || !projectId) return;
    const spec = deleteTarget;

    // Stale optimistic placeholder from a `create_spec` tool call whose
    // promote/cleanup never landed (e.g. the agent issued create_spec
    // twice with near-but-not-equal titles so the title-exact dedupe
    // in `pushSpec` couldn't evict it). Nothing to delete server-side
    // -- just drop the row locally so the user is unblocked.
    if (isPendingSpecId(spec.spec_id)) {
      useSidekickStore.getState().removeSpec(spec.spec_id);
      queryClient.setQueryData<ProjectLayoutBundle | undefined>(
        projectQueryKeys.layout(projectId),
        (current) => removeSpecFromProjectLayout(current, spec.spec_id),
      );
      setDeleteTarget(null);
      return;
    }

    // Defensive: anything else that isn't a UUID would round-trip a
    // bare `Bad Request` from axum's path extractor with no useful
    // body. Surface an actionable message instead of the raw status.
    if (!isUuid(spec.spec_id)) {
      setDeleteError(
        "This spec has an invalid id and can't be deleted from the server. Refresh the page and try again.",
      );
      return;
    }

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      await api.deleteSpec(projectId, spec.spec_id);
      useSidekickStore.getState().removeSpec(spec.spec_id);
      // Keep the project-layout cache in sync so views sourcing `initialSpecs`
      // (Sidekick lists, mobile work/tasks views, …) drop the spec immediately
      // instead of waiting for a refetch.
      queryClient.setQueryData<ProjectLayoutBundle | undefined>(
        projectQueryKeys.layout(projectId),
        (current) => removeSpecFromProjectLayout(current, spec.spec_id),
      );
      setDeleteTarget(null);
    } catch (err) {
      console.error("Failed to delete spec", err);
      const message = getApiErrorMessage(err);
      const details = getApiErrorDetails(err);
      setDeleteError(details ? `${message} ${details}` : message);
    } finally {
      setDeleteLoading(false);
    }
  }, [deleteTarget, projectId, queryClient]);

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
