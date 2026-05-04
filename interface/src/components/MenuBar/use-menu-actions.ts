import { useCallback, useMemo } from "react";
import { useNavigate, useLocation, useMatch } from "react-router-dom";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useOnboardingStore } from "../../features/onboarding/onboarding-store";
import { windowCommand } from "../../lib/windowCommand";
import { zoomIn, zoomOut, resetZoom } from "../../lib/zoom";
import { track } from "../../lib/analytics";
import type { MenuActionKey } from "./menu-config";

const AURA_WEBSITE = "https://aura.ai";

function nextIndex(currentIndex: number, length: number, direction: 1 | -1): number {
  if (length === 0) return -1;
  const next = currentIndex + direction;
  if (next < 0) return length - 1;
  if (next >= length) return 0;
  return next;
}

function execEditCommand(command: string): void {
  if (typeof document === "undefined") return;
  try {
    document.execCommand(command);
  } catch {
    // execCommand is best-effort; some webviews disallow Paste without
    // user-gesture clipboard permissions and Cut/Copy without a selection.
  }
}

interface AgentRouteContext {
  /** Current location pathname; used to decide which agent list applies. */
  pathname: string;
  /** `/agents/:agentId` match, if present. */
  standaloneMatch: ReturnType<typeof useMatch>;
  /** `/projects/:projectId/agents/:agentInstanceId` match, if present. */
  projectMatch: ReturnType<typeof useMatch>;
}

function cycleAgent(
  ctx: AgentRouteContext,
  direction: 1 | -1,
  navigate: ReturnType<typeof useNavigate>,
): void {
  if (ctx.standaloneMatch) {
    const currentId = ctx.standaloneMatch.params.agentId;
    const agents = useAgentStore.getState().agents;
    if (!currentId || agents.length === 0) return;
    const idx = agents.findIndex((agent) => agent.agent_id === currentId);
    const next = nextIndex(idx, agents.length, direction);
    if (next === -1) return;
    const target = agents[next];
    if (!target || target.agent_id === currentId) return;
    navigate(`/agents/${target.agent_id}`);
    return;
  }
  if (ctx.projectMatch) {
    const projectId = ctx.projectMatch.params.projectId;
    const currentInstanceId = ctx.projectMatch.params.agentInstanceId;
    if (!projectId || !currentInstanceId) return;
    const agents = useProjectsListStore.getState().agentsByProject[projectId] ?? [];
    if (agents.length === 0) return;
    const idx = agents.findIndex((agent) => agent.agent_instance_id === currentInstanceId);
    const next = nextIndex(idx, agents.length, direction);
    if (next === -1) return;
    const target = agents[next];
    if (!target || target.agent_instance_id === currentInstanceId) return;
    navigate(`/projects/${projectId}/agents/${target.agent_instance_id}`);
  }
}

export function useAgentNavigationContext(): AgentRouteContext {
  const location = useLocation();
  const standaloneMatch = useMatch("/agents/:agentId");
  const projectMatch = useMatch("/projects/:projectId/agents/:agentInstanceId");
  return { pathname: location.pathname, standaloneMatch, projectMatch };
}

export function isAgentCyclingAvailable(ctx: AgentRouteContext): boolean {
  if (ctx.standaloneMatch) {
    return useAgentStore.getState().agents.length > 1;
  }
  if (ctx.projectMatch) {
    const projectId = ctx.projectMatch.params.projectId;
    if (!projectId) return false;
    const agents = useProjectsListStore.getState().agentsByProject[projectId] ?? [];
    return agents.length > 1;
  }
  return false;
}

export type MenuActionMap = Record<MenuActionKey, () => void>;

export function useMenuActions(): {
  actions: MenuActionMap;
  agentContext: AgentRouteContext;
  isItemDisabled: (key: MenuActionKey) => boolean;
} {
  const navigate = useNavigate();
  const agentContext = useAgentNavigationContext();

  const handleNewAgent = useCallback(() => {
    useAgentStore.getState().openCreateAgentModal();
    navigate("/agents");
  }, [navigate]);

  const handleNewProject = useCallback(() => {
    useProjectsListStore.getState().openNewProjectModal();
  }, []);

  const handleNewWindow = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.ipc?.postMessage === "function") {
      windowCommand("new_window");
      return;
    }
    if (typeof window !== "undefined") {
      window.open(window.location.href, "_blank", "noopener,noreferrer");
    }
  }, []);

  const handleSettings = useCallback(() => {
    useUIModalStore.getState().openOrgSettings();
  }, []);

  const handleExit = useCallback(() => {
    windowCommand("close");
  }, []);

  const handleToggleSidekick = useCallback(() => {
    useAppUIStore.getState().toggleSidekick();
  }, []);

  const handlePreviousAgent = useCallback(() => {
    cycleAgent(agentContext, -1, navigate);
  }, [agentContext, navigate]);

  const handleNextAgent = useCallback(() => {
    cycleAgent(agentContext, 1, navigate);
  }, [agentContext, navigate]);

  const handleToggleFullscreen = useCallback(() => {
    if (typeof window !== "undefined" && typeof window.ipc?.postMessage === "function") {
      windowCommand("toggle_fullscreen");
      return;
    }
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (document.fullscreenElement) {
      void document.exitFullscreen?.();
    } else {
      void root.requestFullscreen?.();
    }
  }, []);

  const handleVisitWebsite = useCallback(() => {
    if (typeof window === "undefined") return;
    window.open(AURA_WEBSITE, "_blank", "noopener,noreferrer");
  }, []);

  const handleGettingStarted = useCallback(() => {
    const store = useOnboardingStore.getState();
    if (store.checklistDismissed) {
      store.reopenChecklist();
    } else {
      store.dismissChecklist();
    }
    track("onboarding_reopened");
  }, []);

  const actions = useMemo<MenuActionMap>(
    () => ({
      "file.newAgent": handleNewAgent,
      "file.newWindow": handleNewWindow,
      "file.newProject": handleNewProject,
      "file.settings": handleSettings,
      "file.exit": handleExit,
      "edit.undo": () => execEditCommand("undo"),
      "edit.redo": () => execEditCommand("redo"),
      "edit.cut": () => execEditCommand("cut"),
      "edit.copy": () => execEditCommand("copy"),
      "edit.paste": () => execEditCommand("paste"),
      "edit.delete": () => execEditCommand("delete"),
      "edit.selectAll": () => execEditCommand("selectAll"),
      "view.toggleSidekick": handleToggleSidekick,
      "view.zoomIn": () => {
        zoomIn();
      },
      "view.zoomOut": () => {
        zoomOut();
      },
      "view.actualSize": () => {
        resetZoom();
      },
      "view.previousAgent": handlePreviousAgent,
      "view.nextAgent": handleNextAgent,
      "view.toggleFullscreen": handleToggleFullscreen,
      "help.visitWebsite": handleVisitWebsite,
      "help.gettingStarted": handleGettingStarted,
    }),
    [
      handleExit,
      handleGettingStarted,
      handleNewAgent,
      handleNewProject,
      handleNewWindow,
      handleNextAgent,
      handlePreviousAgent,
      handleSettings,
      handleToggleFullscreen,
      handleToggleSidekick,
      handleVisitWebsite,
    ],
  );

  const isItemDisabled = useCallback(
    (key: MenuActionKey): boolean => {
      if (key === "view.previousAgent" || key === "view.nextAgent") {
        return !isAgentCyclingAvailable(agentContext);
      }
      return false;
    },
    [agentContext],
  );

  return { actions, agentContext, isItemDisabled };
}
