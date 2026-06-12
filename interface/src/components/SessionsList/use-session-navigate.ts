import { startTransition, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveAppId } from "../../hooks/use-active-app";
import type { AnnotatedSession } from "./session-row-utils";

interface UseSessionNavigateOptions {
  /**
   * The agent that owns the sessions in the list. When the click
   * happens from inside the agents shell, the navigation stays on
   * `/agents/:agentId` so the shell (and its `ChatsTab` sidekick)
   * doesn't unmount. From inside the chat shell it is folded into the
   * `?agent=` query param so `ChatAppRoute` can mount the right agent
   * before the merged session list has loaded. Pass `null` from the
   * projects app — the projects URL is always the right destination
   * there.
   */
  agentId: string | null;
}

/**
 * Shared session-row click handler used by the agents `ChatsTab`, the
 * chat-app sidekick `ChatsTab`, and the projects sidekick. Mirrors the
 * historical-session URL contract for each shell so clicking a row
 * keeps the user in the app they're currently in:
 *
 * - Agents shell:   `/agents/:agentId?project=&instance=&session=`
 * - Chat shell:     `/chat?agent=&project=&instance=&session=`
 * - Projects shell: `/projects/:projectId/agents/:instanceId?session=`
 *
 * The chat-shell URL shape matches the one written by
 * `ChatAppLeftPanel.handleSessionClick`, so `ChatAppRoute` resolves the
 * destination agent identically whether the user clicked a row from
 * the left panel or the right-side sidekick.
 */
export function useSessionNavigate({ agentId }: UseSessionNavigateOptions) {
  const navigate = useNavigate();
  const activeAppId = useActiveAppId();

  return useCallback(
    (session: AnnotatedSession) => {
      // Mark the route change (and the transcript swap it triggers) as a
      // transition so the click feedback paints immediately and React can
      // keep the previous transcript responsive while the new session's
      // panel state renders.
      if (activeAppId === "agents" && agentId) {
        const params = new URLSearchParams({
          project: session._projectId,
          instance: session._agentInstanceId,
          session: session.session_id,
        });
        startTransition(() => navigate(`/agents/${agentId}?${params.toString()}`));
        return;
      }
      if (activeAppId === "chat") {
        const params = new URLSearchParams({
          project: session._projectId,
          instance: session._agentInstanceId,
          session: session.session_id,
        });
        if (agentId) params.set("agent", agentId);
        startTransition(() => navigate(`/chat?${params.toString()}`));
        return;
      }
      startTransition(() =>
        navigate(
          `/projects/${session._projectId}/agents/${session._agentInstanceId}?session=${session.session_id}`,
        ),
      );
    },
    [activeAppId, agentId, navigate],
  );
}
