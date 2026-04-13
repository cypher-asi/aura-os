import { create } from "zustand";
import type { Agent, AgentInstance, Project } from "../types";
import { queryClient } from "../lib/query-client";
import {
  dedupeProjects,
  projectAgentsQueryOptions,
  projectQueryKeys,
  projectsQueryOptions,
} from "../queries/project-queries";
import { BROWSER_DB_STORES, browserDbGet, browserDbSet } from "../lib/browser-db";
import { useOrgStore } from "./org-store";
import { useAuthStore } from "./auth-store";

const NEW_PROJECT_MODAL_STORAGE_KEY = "aura:new-project-modal-open";

function getActiveOrgId(): string | undefined {
  return useOrgStore.getState().activeOrg?.org_id;
}

function syncProjectsQueryCache(projects: Project[]): void {
  queryClient.setQueryData(projectQueryKeys.list(getActiveOrgId()), dedupeProjects(projects));
}

function syncAgentsQueryCache(agentsByProject: Record<string, AgentInstance[]>): void {
  for (const [projectId, agents] of Object.entries(agentsByProject)) {
    queryClient.setQueryData(projectQueryKeys.agents(projectId), agents);
  }
}

interface ProjectsListState {
  projects: Project[];
  loadingProjects: boolean;
  agentsByProject: Record<string, AgentInstance[]>;
  loadingAgentsByProject: Record<string, boolean>;
  newProjectModalOpen: boolean;

  setProjects: (updater: Project[] | ((prev: Project[]) => Project[])) => void;
  refreshProjects: () => Promise<void>;
  setAgentsByProject: (
    updater:
      | Record<string, AgentInstance[]>
      | ((prev: Record<string, AgentInstance[]>) => Record<string, AgentInstance[]>),
  ) => void;
  refreshProjectAgents: (projectId: string) => Promise<AgentInstance[]>;
  patchAgentTemplateFields: (agent: Agent) => void;
  openNewProjectModal: () => void;
  closeNewProjectModal: () => void;
}

type PersistedProjectsListState = {
  projects: Project[];
  agentsByProject: Record<string, AgentInstance[]>;
};

function projectsStateKey(orgId: string | null): string {
  return `state:${orgId ?? "all"}`;
}

async function hydratePersistedProjectsState(orgId: string | null): Promise<void> {
  const cached = await browserDbGet<PersistedProjectsListState>(
    BROWSER_DB_STORES.projects,
    projectsStateKey(orgId),
  );
  if (!cached) {
    return;
  }
  useProjectsListStore.setState({
    projects: cached.projects,
    agentsByProject: cached.agentsByProject,
    loadingProjects: false,
  });
}

let refreshRequestId = 0;
const agentRefreshRequestIds: Record<string, number> = {};

export const useProjectsListStore = create<ProjectsListState>()((set, get) => ({
  projects: [],
  loadingProjects: true,
  agentsByProject: {},
  loadingAgentsByProject: {},
  newProjectModalOpen:
    typeof window !== "undefined" &&
    window.sessionStorage.getItem(NEW_PROJECT_MODAL_STORAGE_KEY) === "1",

  setProjects: (updater) => {
    set((state) => ({
      projects: (() => {
        const nextProjects =
          typeof updater === "function" ? updater(state.projects) : updater;
        const dedupedProjects = dedupeProjects(nextProjects);
        syncProjectsQueryCache(dedupedProjects);
        return dedupedProjects;
      })(),
    }));
  },

  refreshProjects: async () => {
    const requestId = ++refreshRequestId;
    set({ loadingProjects: true });
    try {
      const nextProjects = await queryClient.fetchQuery(
        projectsQueryOptions(getActiveOrgId()),
      );
      if (refreshRequestId === requestId) {
        set({ projects: nextProjects });
      }
    } catch (error) {
      if (refreshRequestId === requestId) {
        console.error("Failed to load projects", error);
      }
    }
    if (refreshRequestId === requestId) {
      set({ loadingProjects: false });
    }
  },

  setAgentsByProject: (updater) => {
    set((state) => ({
      agentsByProject: (() => {
        const nextAgentsByProject =
          typeof updater === "function" ? updater(state.agentsByProject) : updater;
        syncAgentsQueryCache(nextAgentsByProject);
        return nextAgentsByProject;
      })(),
    }));
  },

  refreshProjectAgents: async (projectId: string) => {
    const requestId = (agentRefreshRequestIds[projectId] ?? 0) + 1;
    agentRefreshRequestIds[projectId] = requestId;
    set((state) => ({
      loadingAgentsByProject: { ...state.loadingAgentsByProject, [projectId]: true },
    }));
    let result = get().agentsByProject[projectId] ?? [];

    try {
      const nextAgents = await queryClient.fetchQuery(
        projectAgentsQueryOptions(projectId),
      );
      if (agentRefreshRequestIds[projectId] !== requestId) {
        return get().agentsByProject[projectId] ?? result;
      }
      set((state) => ({
        agentsByProject: { ...state.agentsByProject, [projectId]: nextAgents },
      }));
      result = nextAgents;
    } catch (error) {
      if (agentRefreshRequestIds[projectId] === requestId) {
        console.error("Failed to load project agents", error);
        set((state) => ({
          agentsByProject: (() => {
            if (projectId in state.agentsByProject) {
              return state.agentsByProject;
            }
            const nextAgentsByProject = { ...state.agentsByProject, [projectId]: [] };
            syncAgentsQueryCache(nextAgentsByProject);
            return nextAgentsByProject;
          })(),
        }));
      }
      result = get().agentsByProject[projectId] ?? [];
    } finally {
      if (agentRefreshRequestIds[projectId] === requestId) {
        set((state) => ({
          loadingAgentsByProject: { ...state.loadingAgentsByProject, [projectId]: false },
        }));
      }
    }

    return result;
  },

  patchAgentTemplateFields: (agent: Agent) => {
    set((state) => {
      const next: Record<string, AgentInstance[]> = {};
      let changed = false;
      for (const [pid, instances] of Object.entries(state.agentsByProject)) {
        const updated = instances.map((inst) => {
          if (inst.agent_id !== agent.agent_id) return inst;
          changed = true;
          return {
            ...inst,
            name: agent.name,
            role: agent.role,
            personality: agent.personality,
            system_prompt: agent.system_prompt,
            skills: agent.skills,
            icon: agent.icon,
          };
        });
        next[pid] = updated;
      }
      if (changed) {
        syncAgentsQueryCache(next);
        return { agentsByProject: next };
      }
      return {};
    });
  },

  openNewProjectModal: () => set({ newProjectModalOpen: true }),
  closeNewProjectModal: () => set({ newProjectModalOpen: false }),
}));

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

// Sync newProjectModalOpen to sessionStorage
useProjectsListStore.subscribe((state, prevState) => {
  if (state.newProjectModalOpen === prevState.newProjectModalOpen) return;
  if (typeof window === "undefined") return;
  if (state.newProjectModalOpen) {
    window.sessionStorage.setItem(NEW_PROJECT_MODAL_STORAGE_KEY, "1");
  } else {
    window.sessionStorage.removeItem(NEW_PROJECT_MODAL_STORAGE_KEY);
  }
});

let _batchId = 0;
let _knownProjectIds = new Set<string>();
let _agentPrefetchTimer: ReturnType<typeof setTimeout> | null = null;
let _queuedAgentPrefetchIds: string[] = [];
const AGENT_PREFETCH_DELAY_MS = 24;

function scheduleAgentPrefetch(batchId: number): void {
  if (_agentPrefetchTimer != null) return;

  const pump = () => {
    _agentPrefetchTimer = null;
    if (_batchId !== batchId) return;

    const nextProjectId = _queuedAgentPrefetchIds.shift();
    if (!nextProjectId) return;

    useProjectsListStore.setState((state) => ({
      loadingAgentsByProject: {
        ...state.loadingAgentsByProject,
        [nextProjectId]: true,
      },
    }));

    queryClient
      .fetchQuery(projectAgentsQueryOptions(nextProjectId))
      .catch(() => [] as AgentInstance[])
      .then((agents) => {
        if (_batchId !== batchId) return;
        useProjectsListStore.setState((state) => ({
          agentsByProject: {
            ...state.agentsByProject,
            [nextProjectId]: agents,
          },
          loadingAgentsByProject: {
            ...state.loadingAgentsByProject,
            [nextProjectId]: false,
          },
        }));
      })
      .finally(() => {
        if (_batchId !== batchId) return;
        if (_queuedAgentPrefetchIds.length === 0) return;
        _agentPrefetchTimer = setTimeout(pump, AGENT_PREFETCH_DELAY_MS);
      });
  };

  _agentPrefetchTimer = setTimeout(pump, AGENT_PREFETCH_DELAY_MS);
}

// Auto-refresh projects when active org changes
let _prevOrgId: string | null = null;
useOrgStore.subscribe((state) => {
  const orgId = state.activeOrg?.org_id ?? null;
  if (orgId === _prevOrgId) return;
  _prevOrgId = orgId;
  _batchId += 1;
  if (_agentPrefetchTimer != null) {
    clearTimeout(_agentPrefetchTimer);
    _agentPrefetchTimer = null;
  }
  _queuedAgentPrefetchIds = [];
  queryClient.removeQueries({ queryKey: projectQueryKeys.root });
  useProjectsListStore.setState({ agentsByProject: {}, loadingAgentsByProject: {} });
  _knownProjectIds = new Set();
  void (async () => {
    await hydratePersistedProjectsState(orgId);
    await useProjectsListStore.getState().refreshProjects();
  })();
});

// Incrementally prefetch project agents in the background instead of fanning
// out requests for every project at once. This keeps navigation snappy while
// preserving cached agent lookups for later surfaces like standalone agent chat.
//
// Also refresh projects when authentication changes. This keeps project loading
// alive in environments where org metadata is unavailable but /api/projects
// still returns the user's accessible projects.
let _prevProjectsUserId: string | null = null;
useAuthStore.subscribe((state) => {
  const userId = state.user?.user_id ?? null;
  if (userId === _prevProjectsUserId) return;
  _prevProjectsUserId = userId;

  if (!userId) {
    _prevOrgId = null;
    _knownProjectIds = new Set();
    useProjectsListStore.setState({
      projects: [],
      loadingProjects: false,
      agentsByProject: {},
      loadingAgentsByProject: {},
    });
    return;
  }

  void (async () => {
    await hydratePersistedProjectsState(getActiveOrgId() ?? null);
    await useProjectsListStore.getState().refreshProjects();
  })();
});

useProjectsListStore.subscribe((state) => {
  void browserDbSet(
    BROWSER_DB_STORES.projects,
    projectsStateKey(getActiveOrgId() ?? null),
    {
      projects: state.projects,
      agentsByProject: state.agentsByProject,
    },
  );
});

useProjectsListStore.subscribe((state) => {
  const currentIds = new Set(state.projects.map((p) => p.project_id));
  const newIds = state.projects
    .filter(
      (project) =>
        !_knownProjectIds.has(project.project_id) &&
        !(project.project_id in state.agentsByProject),
    )
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .map((project) => project.project_id);
  _knownProjectIds = currentIds;
  if (newIds.length === 0) return;

  const batchId = ++_batchId;
  if (_agentPrefetchTimer != null) {
    clearTimeout(_agentPrefetchTimer);
    _agentPrefetchTimer = null;
  }
  _queuedAgentPrefetchIds = newIds;
  scheduleAgentPrefetch(batchId);
});

// ---------------------------------------------------------------------------
// Derived helpers (pure functions, memoize with useMemo in consumers)
// ---------------------------------------------------------------------------

export function getRecentProjects(projects: Project[]): Project[] {
  return [...projects]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 3);
}

export function getMostRecentProject(projects: Project[]): Project | null {
  return getRecentProjects(projects)[0] ?? null;
}
