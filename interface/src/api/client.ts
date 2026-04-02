export {
  ApiClientError,
  isInsufficientCreditsError,
  dispatchInsufficientCredits,
  INSUFFICIENT_CREDITS_EVENT,
} from "./core";

export type {
  SpecGenStreamCallbacks,
  StreamEventHandler,
} from "./streams";

export type {
  CreateProjectRequest,
  UpdateProjectRequest,
  OrbitRepo,
  OrbitCollaborator,
  ImportedProjectFile,
  CreateImportedProjectRequest,
} from "./projects";

export type { DirEntry } from "./desktop";
export type { LoopStatusResponse } from "./loop";

import { authApi } from "./auth";
import { projectsApi } from "./projects";
import { tasksApi } from "./tasks";
import { agentTemplatesApi, agentInstancesApi, sessionsApi, superAgentApi } from "./agents";
import { orgsApi } from "./orgs";
import { desktopApi } from "./desktop";
import { loopApi } from "./loop";
import { followsApi, usersApi, profilesApi, feedApi, leaderboardApi, platformStatsApi, usageApi, activityApi } from "./social";
import { environmentApi } from "./environment";
import { swarmApi } from "./swarm";
import { processApi } from "./process";
import { memoryApi } from "./memory";
import { harnessSkillsApi } from "./harness-skills";

export const api = {
  auth: authApi,
  orgs: orgsApi,
  ...projectsApi,
  ...tasksApi,
  agents: agentTemplatesApi,
  ...agentInstancesApi,
  ...sessionsApi,
  ...desktopApi,
  ...loopApi,
  follows: followsApi,
  users: usersApi,
  profiles: profilesApi,
  feed: feedApi,
  leaderboard: leaderboardApi,
  platformStats: platformStatsApi,
  usage: usageApi,
  activity: activityApi,
  environment: environmentApi,
  swarm: swarmApi,
  superAgent: superAgentApi,
  process: processApi,
  memory: memoryApi,
  harnessSkills: harnessSkillsApi,
};
