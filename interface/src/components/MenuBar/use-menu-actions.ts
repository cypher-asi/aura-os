import { useCallback, useMemo } from "react";
import { useNavigate, useLocation, useMatch } from "react-router-dom";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useAppUIStore } from "../../stores/app-ui-store";
import { useOnboardingStore } from "../../features/onboarding/onboarding-store";
import { useAuth } from "../../stores/auth-store";
import { useLogout } from "../../stores/use-logout";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useQuickPromptStore } from "../../stores/quick-prompt-store";
import { filterRuntimeVisibleAgents } from "../../shared/lib/agent-runtime-visibility";
import { windowCommand } from "../../lib/windowCommand";
import { zoomIn, zoomOut, resetZoom } from "../../lib/zoom";
import { track } from "../../lib/analytics";
import type { MenuActionKey } from "./menu-config";

const AURA_WEBSITE = "https://aura.ai";
const AURA_DOWNLOADS = "https://aura.ai/download";
const AURA_OBSERVABILITY = "https://aura.ai/observability";

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
  /** Current query string; the Chat app carries its active agent here. */
  search: string;
  /** `/agents/:agentId` match, if present. */
  standaloneMatch: ReturnType<typeof useMatch>;
  /** `/projects/:projectId/agents/:agentInstanceId` match, if present. */
  projectMatch: ReturnType<typeof useMatch>;
}

function cycleAgent(
  ctx: AgentRouteContext,
  direction: 1 | -1,
  navigate: ReturnType<typeof useNavigate>,
  remoteOnly: boolean,
): void {
  if (ctx.standaloneMatch) {
    const currentId = ctx.standaloneMatch.params.agentId;
    // Cycle over the same runtime-visible fleet the sidebar shows, so
    // a hotkey can't land on a local agent that's hidden on web/mobile.
    const agents = filterRuntimeVisibleAgents(
      useAgentStore.getState().agents,
      remoteOnly,
    );
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
    const agents = filterRuntimeVisibleAgents(
      useProjectsListStore.getState().agentsByProject[projectId] ?? [],
      remoteOnly,
    );
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
  return {
    pathname: location.pathname,
    search: location.search,
    standaloneMatch,
    projectMatch,
  };
}

export function isAgentCyclingAvailable(
  ctx: AgentRouteContext,
  remoteOnly: boolean,
): boolean {
  if (ctx.standaloneMatch) {
    return (
      filterRuntimeVisibleAgents(useAgentStore.getState().agents, remoteOnly)
        .length > 1
    );
  }
  if (ctx.projectMatch) {
    const projectId = ctx.projectMatch.params.projectId;
    if (!projectId) return false;
    const agents = filterRuntimeVisibleAgents(
      useProjectsListStore.getState().agentsByProject[projectId] ?? [],
      remoteOnly,
    );
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
  const { isAuthenticated } = useAuth();
  const { remoteOnly } = useAuraCapabilities();
  const logout = useLogout();

  const handleNewAgent = useCallback(() => {
    useAgentStore.getState().openCreateAgentModal();
    navigate("/agents");
  }, [navigate]);

  const handleQuickPrompt = useCallback(() => {
    let preferredAgentId = agentContext.standaloneMatch?.params.agentId ?? null;
    if (!preferredAgentId && agentContext.pathname === "/chat") {
      preferredAgentId = new URLSearchParams(agentContext.search).get("agent");
    }
    if (!preferredAgentId && agentContext.projectMatch) {
      const projectId = agentContext.projectMatch.params.projectId;
      const instanceId = agentContext.projectMatch.params.agentInstanceId;
      preferredAgentId =
        (projectId && instanceId
          ? useProjectsListStore
              .getState()
              .agentsByProject[projectId]?.find(
                (agent) => agent.agent_instance_id === instanceId,
              )?.agent_id
          : null) ?? null;
    }
    preferredAgentId ??= useAgentStore.getState().selectedAgentId ?? null;
    useUIModalStore.getState().closeCommandPalette();
    useQuickPromptStore.getState().open(preferredAgentId);
  }, [agentContext]);

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

  const handleLogout = useCallback(() => {
    void logout();
  }, [logout]);

  const handleToggleSidekick = useCallback(() => {
    useAppUIStore.getState().toggleSidekick();
  }, []);

  const handleToggleCommandPalette = useCallback(() => {
    const modalStore = useUIModalStore.getState();
    if (!modalStore.commandPaletteOpen) {
      useQuickPromptStore.getState().close();
    }
    modalStore.toggleCommandPalette();
  }, []);

  const handlePreviousAgent = useCallback(() => {
    cycleAgent(agentContext, -1, navigate, remoteOnly);
  }, [agentContext, navigate, remoteOnly]);

  const handleNextAgent = useCallback(() => {
    cycleAgent(agentContext, 1, navigate, remoteOnly);
  }, [agentContext, navigate, remoteOnly]);

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

  const handleDownloads = useCallback(() => {
    // Logged-in (desktop) users get the Downloads page in an in-app
    // modal so it opens inside the actual app rather than a new browser
    // tab or a full route navigation.
    if (isAuthenticated) {
      useUIModalStore.getState().openDownloads();
      return;
    }
    if (typeof window === "undefined") return;
    window.open(AURA_DOWNLOADS, "_blank", "noopener,noreferrer");
  }, [isAuthenticated]);

  const handleChangelog = useCallback(() => {
    useUIModalStore.getState().openChangelog();
  }, []);

  const handleStatus = useCallback(() => {
    if (isAuthenticated) {
      navigate("/observability");
      return;
    }
    if (typeof window === "undefined") return;
    window.open(AURA_OBSERVABILITY, "_blank", "noopener,noreferrer");
  }, [isAuthenticated, navigate]);

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
      "file.quickPrompt": handleQuickPrompt,
      "file.newAgent": handleNewAgent,
      "file.newWindow": handleNewWindow,
      "file.newProject": handleNewProject,
      "file.settings": handleSettings,
      "file.logout": handleLogout,
      "file.exit": handleExit,
      "edit.undo": () => execEditCommand("undo"),
      "edit.redo": () => execEditCommand("redo"),
      "edit.cut": () => execEditCommand("cut"),
      "edit.copy": () => execEditCommand("copy"),
      "edit.paste": () => execEditCommand("paste"),
      "edit.delete": () => execEditCommand("delete"),
      "edit.selectAll": () => execEditCommand("selectAll"),
      "view.commandPalette": handleToggleCommandPalette,
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
      "help.downloads": handleDownloads,
      "help.status": handleStatus,
      "help.changelog": handleChangelog,
      "help.gettingStarted": handleGettingStarted,
    }),
    [
      handleChangelog,
      handleDownloads,
      handleExit,
      handleGettingStarted,
      handleLogout,
      handleQuickPrompt,
      handleNewAgent,
      handleNewProject,
      handleNewWindow,
      handleNextAgent,
      handlePreviousAgent,
      handleSettings,
      handleStatus,
      handleToggleCommandPalette,
      handleToggleFullscreen,
      handleToggleSidekick,
      handleVisitWebsite,
    ],
  );

  const isItemDisabled = useCallback(
    (key: MenuActionKey): boolean => {
      if (key === "view.previousAgent" || key === "view.nextAgent") {
        return !isAgentCyclingAvailable(agentContext, remoteOnly);
      }
      if (key === "file.logout") {
        return !isAuthenticated;
      }
      return false;
    },
    [agentContext, isAuthenticated, remoteOnly],
  );

  return { actions, agentContext, isItemDisabled };
}
