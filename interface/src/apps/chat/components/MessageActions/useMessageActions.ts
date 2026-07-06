import { useCallback, useEffect, useRef, useState } from "react";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { createSessionShare } from "../../../../shared/api/shares";
import { copyToClipboard } from "../../../../shared/utils/clipboard";
import { useProjectsListStore } from "../../../../stores/projects-list-store";
import { parseStreamKey } from "./parse-stream-key";
import { getRegenerateTurn } from "./regenerate-registry";

/** Metadata surfaced in the More popover. */
export interface MessageActionsMeta {
  sessionId: string | null;
  projectName: string;
  workspacePath: string | null;
}

export interface MessageActionsState {
  meta: MessageActionsMeta;
  /** True for ~1.8s after the share link lands on the clipboard. */
  shared: boolean;
  /** True while the first share request for this session is in flight. */
  isSharing: boolean;
  /** True when sharing is possible (a persisted session id is known). */
  canShare: boolean;
  /** Create (or reuse) the share, copy its URL, and flash the toggle. */
  copyShareLink: () => Promise<void>;
  /** Re-send the prompt that produced this assistant turn. */
  regenerate: () => void;
}

const SHARED_RESET_MS = 1800;

function readShareContextFromLocation(): {
  projectId: string | null;
  agentInstanceId: string | null;
  sessionId: string | null;
} {
  if (typeof window === "undefined") {
    return { projectId: null, agentInstanceId: null, sessionId: null };
  }
  const params = new URLSearchParams(window.location.search);
  let projectId = params.get("project");
  let agentInstanceId = params.get("instance");
  const sessionId = params.get("session");

  if (!projectId || !agentInstanceId) {
    const match = window.location.pathname.match(
      /^\/projects\/([^/]+)\/agents\/([^/?#]+)/,
    );
    if (match) {
      projectId = projectId ?? decodeURIComponent(match[1]);
      agentInstanceId = agentInstanceId ?? decodeURIComponent(match[2]);
    }
  }

  return { projectId, agentInstanceId, sessionId };
}

/**
 * Facade hook for the assistant message action row. It sources the
 * popover metadata (session id / project / workspace) from the existing
 * `streamKey` + projects store rather than prop-drilling, composes the
 * share affordance from the shares API + clipboard helper, and resolves
 * the per-turn regenerate handler the chat surface registered for this
 * `streamKey`. Keeping this logic here lets `MessageActions` take only
 * `message` + `streamKey` as props.
 */
export function useMessageActions(
  streamKey: string,
  message: DisplaySessionEvent,
): MessageActionsState {
  const parsed = parseStreamKey(streamKey);
  const routeContext = readShareContextFromLocation();
  const projectId = routeContext.projectId ?? parsed?.projectId ?? "";
  const agentInstanceId = routeContext.agentInstanceId ?? parsed?.agentInstanceId ?? "";
  const sessionId = routeContext.sessionId ?? parsed?.sessionId ?? null;

  const projectName = useProjectsListStore(
    (state) =>
      state.projects.find((p) => p.project_id === projectId)?.name ?? "",
  );
  const workspacePath = useProjectsListStore(
    (state) =>
      state.agentsByProject[projectId]?.find(
        (agent) => agent.agent_instance_id === agentInstanceId,
      )?.workspace_path ?? null,
  );

  const [shared, setShared] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const cachedUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const canShare = Boolean(projectId && agentInstanceId && sessionId);

  const copyShareLink = useCallback(async () => {
    if (isSharing || !projectId || !agentInstanceId || !sessionId) return;
    try {
      let url = cachedUrlRef.current;
      if (!url) {
        setIsSharing(true);
        const result = await createSessionShare({
          projectId,
          agentInstanceId,
          sessionId,
        });
        url = result.url;
        cachedUrlRef.current = url;
      }
      await copyToClipboard(url);
      setShared(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setShared(false);
        timerRef.current = null;
      }, SHARED_RESET_MS);
    } catch (err) {
      console.warn("share failed", err);
    } finally {
      setIsSharing(false);
    }
  }, [agentInstanceId, isSharing, projectId, sessionId]);

  const regenerate = useCallback(() => {
    getRegenerateTurn(streamKey)?.(message.id);
  }, [streamKey, message.id]);

  return {
    meta: { sessionId, projectName, workspacePath },
    shared,
    isSharing,
    canShare,
    copyShareLink,
    regenerate,
  };
}
