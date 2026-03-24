import { create } from "zustand";
import type { Agent, AgentInstance, Project } from "../types";
import { api } from "../api/client";
import { useOrgStore } from "./org-store";

const NEW_PROJECT_MODAL_STORAGE_KEY = "aura:new-project-modal-open";

function dedupeProjects(projects: Project[]) {
  const seen = new Set<string>();
  const next: Project[] = [];
  for (const project of projects) {
    if (seen.has(project.project_id)) continue;
    seen.add(project.project_id);
    next.push(project);
  }
  return next;
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
      projects: typeof updater === "function" ? updater(state.projects) : updater,
    }));
  },

  refreshProjects: async () => {
    const requestId = ++refreshRequestId;
    set({ loadingProjects: true });
    try {
      const activeOrg = useOrgStore.getState().activeOrg;
      const nextProjects = await api.listProjects(activeOrg?.org_id);
      if (refreshRequestId === requestId) {
        set({ projects: dedupeProjects(nextProjects) });
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
      agentsByProject:
        typeof updater === "function" ? updater(state.agentsByProject) : updater,
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
      const nextAgents = await api.listAgentInstances(projectId);
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
          agentsByProject:
            projectId in state.agentsByProject
              ? state.agentsByProject
              : { ...state.agentsByProject, [projectId]: [] },
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
      return changed ? { agentsByProject: next } : {};
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

// Auto-refresh projects when active org changes
let _prevOrgId: string | null = null;
useOrgStore.subscribe((state) => {
  const orgId = state.activeOrg?.org_id ?? null;
  if (orgId === _prevOrgId) return;
  _prevOrgId = orgId;
  useProjectsListStore.setState({ agentsByProject: {}, loadingAgentsByProject: {} });
  _knownProjectIds = new Set();
  useProjectsListStore.getState().refreshProjects();
});

// Batch-load agents for newly fetched projects
let _batchId = 0;
let _knownProjectIds = new Set<string>();
useProjectsListStore.subscribe((state) => {
  const currentIds = new Set(state.projects.map((p) => p.project_id));
  const newIds = [...currentIds].filter(
    (id) => !_knownProjectIds.has(id) && !(id in state.agentsByProject),
  );
  _knownProjectIds = currentIds;
  if (newIds.length === 0) return;

  const thisBatch = ++_batchId;

  useProjectsListStore.setState((s) => {
    const next = { ...s.loadingAgentsByProject };
    for (const id of newIds) next[id] = true;
    return { loadingAgentsByProject: next };
  });

  Promise.all(
    newIds.map((projectId) =>
      api
        .listAgentInstances(projectId)
        .then((agents) => ({ projectId, agents }))
        .catch(() => ({ projectId, agents: [] as AgentInstance[] })),
    ),
  ).then((results) => {
    if (_batchId !== thisBatch) return;
    const batch: Record<string, AgentInstance[]> = {};
    for (const { projectId, agents } of results) {
      batch[projectId] = agents;
    }
    useProjectsListStore.setState((s) => {
      const nextLoading = { ...s.loadingAgentsByProject };
      for (const id of newIds) nextLoading[id] = false;
      return {
        agentsByProject: { ...s.agentsByProject, ...batch },
        loadingAgentsByProject: nextLoading,
      };
    });
  });
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
