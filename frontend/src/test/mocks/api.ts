import { vi } from "vitest";

function stub(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(undefined);
}

export function mockAuthApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    login: stub(),
    register: stub(),
    getSession: stub(),
    validate: stub(),
    logout: stub(),
  };
}

export function mockSettingsApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getApiKeyInfo: stub(),
    getFeeSchedule: stub(),
    putFeeSchedule: stub(),
  };
}

export function mockOrgsApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    list: stub(),
    create: stub(),
    get: stub(),
    update: stub(),
    listMembers: stub(),
    updateMemberRole: stub(),
    removeMember: stub(),
    createInvite: stub(),
    listInvites: stub(),
    revokeInvite: stub(),
    acceptInvite: stub(),
    getBilling: stub(),
    setBilling: stub(),
    getCreditBalance: stub(),
    createCreditCheckout: stub(),
    getTransactions: stub(),
    getAccount: stub(),
  };
}

export function mockProjectsApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    listProjects: stub(),
    createProject: stub(),
    importProject: stub(),
    getProject: stub(),
    listOrbitRepos: stub(),
    listProjectOrbitCollaborators: stub(),
    updateProject: stub(),
    deleteProject: stub(),
    archiveProject: stub(),
    listSpecs: stub(),
    getSpec: stub(),
    generateSpecs: stub(),
    generateSpecsStream: stub(),
  };
}

export function mockTasksApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    listTasks: stub(),
    listTasksBySpec: stub(),
    transitionTask: stub(),
    retryTask: stub(),
    runTask: stub(),
    getTaskOutput: stub(),
  };
}

export function mockAgentTemplatesApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    list: stub(),
    create: stub(),
    get: stub(),
    update: stub(),
    delete: stub(),
    listMessages: stub(),
    sendMessageStream: stub(),
  };
}

export function mockAgentInstancesApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    createAgentInstance: stub(),
    listAgentInstances: stub(),
    getAgentInstance: stub(),
    updateAgentInstance: stub(),
    deleteAgentInstance: stub(),
    getMessages: stub(),
    sendMessageStream: stub(),
  };
}

export function mockSessionsApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    listProjectSessions: stub(),
    listSessions: stub(),
    getSession: stub(),
    listSessionTasks: stub(),
    listSessionMessages: stub(),
  };
}

export function mockDesktopApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    getLogEntries: stub(),
    listDirectory: stub(),
    pickFolder: stub(),
    pickFile: stub(),
    openPath: stub(),
    openIde: stub(),
    readFile: stub(),
    writeFile: stub(),
    getUpdateStatus: stub(),
    installUpdate: stub(),
    setUpdateChannel: stub(),
  };
}

export function mockLoopApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    startLoop: stub(),
    pauseLoop: stub(),
    stopLoop: stub(),
    getLoopStatus: stub(),
  };
}

export function mockSocialApis(): Record<string, Record<string, ReturnType<typeof vi.fn>>> {
  return {
    follows: {
      follow: stub(),
      unfollow: stub(),
      list: stub(),
      check: stub(),
    },
    users: {
      me: stub(),
      get: stub(),
      updateMe: stub(),
    },
    profiles: {
      get: stub(),
    },
    feed: {
      list: stub(),
      createPost: stub(),
      getPost: stub(),
      getProfilePosts: stub(),
      getComments: stub(),
      addComment: stub(),
      deleteComment: stub(),
    },
    leaderboard: {
      get: stub(),
    },
    platformStats: {
      get: stub(),
    },
    usage: {
      personal: stub(),
      org: stub(),
      orgMembers: stub(),
    },
    activity: {
      getCommitHistory: stub(),
    },
  };
}

export function mockTerminalApi(): Record<string, ReturnType<typeof vi.fn>> {
  return {
    spawnTerminal: stub(),
    listTerminals: stub(),
    killTerminal: stub(),
    terminalWsUrl: vi.fn().mockReturnValue("ws://localhost/ws/terminal/test"),
  };
}

export function mockStreamSSE(): ReturnType<typeof vi.fn> {
  return stub();
}

type MockApiResult = {
  auth: Record<string, ReturnType<typeof vi.fn>>;
  settings: Record<string, ReturnType<typeof vi.fn>>;
  orgs: Record<string, ReturnType<typeof vi.fn>>;
  projects: Record<string, ReturnType<typeof vi.fn>>;
  tasks: Record<string, ReturnType<typeof vi.fn>>;
  agentTemplates: Record<string, ReturnType<typeof vi.fn>>;
  agentInstances: Record<string, ReturnType<typeof vi.fn>>;
  sessions: Record<string, ReturnType<typeof vi.fn>>;
  desktop: Record<string, ReturnType<typeof vi.fn>>;
  loop: Record<string, ReturnType<typeof vi.fn>>;
  social: Record<string, Record<string, ReturnType<typeof vi.fn>>>;
  terminal: Record<string, ReturnType<typeof vi.fn>>;
  streamSSE: ReturnType<typeof vi.fn>;
};

export function mockApi(): MockApiResult {
  return {
    auth: mockAuthApi(),
    settings: mockSettingsApi(),
    orgs: mockOrgsApi(),
    projects: mockProjectsApi(),
    tasks: mockTasksApi(),
    agentTemplates: mockAgentTemplatesApi(),
    agentInstances: mockAgentInstancesApi(),
    sessions: mockSessionsApi(),
    desktop: mockDesktopApi(),
    loop: mockLoopApi(),
    social: mockSocialApis(),
    terminal: mockTerminalApi(),
    streamSSE: mockStreamSSE(),
  };
}
