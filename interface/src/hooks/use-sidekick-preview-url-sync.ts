import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useSidekickStore } from "../stores/sidekick-store";
import type { Spec, Task } from "../shared/types";

/**
 * Query parameter that encodes the currently-open sidekick preview item
 * so a hard reload can rehydrate the right spec / task panel — closing
 * the same loop as `useChatHistorySync`'s mid-turn refresh recovery for
 * the chat surface.
 *
 * Format: `<kind>:<id>` where `kind` is one of `spec` or `task`.
 *
 * Notes intentionally omitted from the URL: `specs_overview`, `session`
 * and `log` preview items are entirely ephemeral runtime objects (the
 * overview composes the live in-memory specs list, sessions key off
 * snapshots, logs are tail-streamed) and have no stable id we can use
 * to look them up after a refresh.
 */
const PREVIEW_PARAM = "preview";

function encodePreview(
  current: ReturnType<typeof useSidekickStore.getState>["previewItem"],
): string | null {
  if (!current) return null;
  switch (current.kind) {
    case "spec":
      return `spec:${current.spec.spec_id}`;
    case "task":
      return `task:${current.task.task_id}`;
    default:
      return null;
  }
}

interface PreviewUrlSyncOptions {
  specs: Spec[];
  tasks: Task[];
}

/**
 * Two-way binding between the sidekick `previewItem` and the
 * `?preview=<kind>:<id>` URL query param.
 *
 * On mount and whenever specs/tasks load, parses the URL and dispatches
 * the matching `viewSpec` / `viewTask` so the preview panel reopens to
 * the same item the user had open before the refresh. Whenever the user
 * navigates the preview interactively, replaces the URL (no history
 * entry) so the back-button keeps its usual behaviour.
 *
 * Skips no-op writes (URL already in the desired state) so React Router
 * does not generate spurious navigations during normal renders.
 */
export function useSidekickPreviewUrlSync({ specs, tasks }: PreviewUrlSyncOptions) {
  const [searchParams, setSearchParams] = useSearchParams();
  const previewParam = searchParams.get(PREVIEW_PARAM);
  const { previewItem, viewSpec, viewTask } = useSidekickStore(
    useShallow((s) => ({
      previewItem: s.previewItem,
      viewSpec: s.viewSpec,
      viewTask: s.viewTask,
    })),
  );

  // Latest specs/tasks captured in a ref so the URL→state effect does
  // not re-fire on every list refetch (it only needs the up-to-date
  // collection at the moment the URL hints us to open something).
  const dataRef = useRef({ specs, tasks });
  useEffect(() => {
    dataRef.current = { specs, tasks };
  }, [specs, tasks]);

  // URL → state. Only pushes once per distinct URL token (tracked by
  // `lastHydratedRef`) so user-initiated preview changes are not
  // immediately undone by the next hydration pass.
  const lastHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!previewParam) {
      lastHydratedRef.current = null;
      return;
    }
    if (lastHydratedRef.current === previewParam) return;
    if (previewItem && encodePreview(previewItem) === previewParam) {
      lastHydratedRef.current = previewParam;
      return;
    }

    const colon = previewParam.indexOf(":");
    if (colon < 0) return;
    const kind = previewParam.slice(0, colon);
    const id = previewParam.slice(colon + 1);
    if (!id) return;

    if (kind === "spec") {
      const spec = dataRef.current.specs.find((s) => s.spec_id === id);
      if (!spec) return;
      viewSpec(spec);
      lastHydratedRef.current = previewParam;
    } else if (kind === "task") {
      const task = dataRef.current.tasks.find((t) => t.task_id === id);
      if (!task) return;
      viewTask(task);
      lastHydratedRef.current = previewParam;
    }
  }, [
    previewParam,
    previewItem,
    viewSpec,
    viewTask,
    specs.length,
    tasks.length,
  ]);

  // state → URL.
  useEffect(() => {
    const encoded = encodePreview(previewItem);
    const current = searchParams.get(PREVIEW_PARAM);
    if (encoded == null) {
      if (current == null) return;
      const next = new URLSearchParams(searchParams);
      next.delete(PREVIEW_PARAM);
      setSearchParams(next, { replace: true });
      return;
    }
    if (current === encoded) return;
    const next = new URLSearchParams(searchParams);
    next.set(PREVIEW_PARAM, encoded);
    setSearchParams(next, { replace: true });
  }, [previewItem, searchParams, setSearchParams]);
}
