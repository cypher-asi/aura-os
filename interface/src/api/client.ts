export {
  ApiClientError,
  isInsufficientCreditsError,
  isAgentBusyError,
  dispatchInsufficientCredits,
  INSUFFICIENT_CREDITS_EVENT,
} from "../shared/api/core";

export type {
  SpecGenStreamCallbacks,
  StreamEventHandler,
} from "../shared/api/streams";

export type {
  CreateProjectRequest,
  UpdateProjectRequest,
  OrbitRepo,
  OrbitCollaborator,
  ImportedProjectFile,
  CreateImportedProjectRequest,
} from "../shared/api/projects";
export { STANDALONE_AGENT_HISTORY_LIMIT } from "../shared/api/agents";

export type { DirEntry } from "../shared/api/desktop";
export type { LoopStatusResponse } from "../shared/api/loop";

import { authApi } from "../shared/api/auth";
import { projectsApi } from "../shared/api/projects";
import { tasksApi } from "../shared/api/tasks";
import { agentTemplatesApi, agentInstancesApi, sessionsApi, superAgentApi } from "../shared/api/agents";
import { orgsApi } from "../shared/api/orgs";
import { desktopApi } from "../shared/api/desktop";
import { loopApi } from "../shared/api/loop";
import { followsApi, usersApi, profilesApi, feedApi, leaderboardApi, platformStatsApi, usageApi, activityApi } from "../shared/api/social";
import { feedbackApi } from "./feedback";
import { environmentApi } from "../shared/api/environment";
import { swarmApi } from "../shared/api/swarm";
import { processApi } from "../shared/api/process";
import { memoryApi } from "../shared/api/memory";
import { harnessSkillsApi } from "../shared/api/harness-skills";
import { notesApi } from "../shared/api/notes";
import { marketplaceApi } from "./marketplace";
import { debugApi } from "../shared/api/debug";

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
  feedback: feedbackApi,
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
  notes: notesApi,
  marketplace: marketplaceApi,
  debug: debugApi,
};
