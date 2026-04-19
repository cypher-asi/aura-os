import type { HarnessSkill, HarnessSkillActivation, HarnessSkillInstallation } from "../types";
import { apiFetch } from "./core";

export interface MySkillEntry {
  name: string;
  description: string;
  path: string;
  user_invocable: boolean;
  model_invocable: boolean;
}

export const harnessSkillsApi = {
  listSkills: () =>
    apiFetch<HarnessSkill[]>(`/api/harness/skills`),
  listMySkills: () =>
    apiFetch<MySkillEntry[]>(`/api/harness/skills/mine`),
  getSkill: (name: string) =>
    apiFetch<HarnessSkill>(`/api/harness/skills/${name}`),
  createSkill: (data: {
    name: string;
    description: string;
    body?: string;
    allowed_tools?: string[];
    model?: string;
    context?: string;
    user_invocable?: boolean;
    model_invocable?: boolean;
    agent_id?: string;
  }) =>
    apiFetch<{
      name: string;
      path: string;
      created: boolean;
      registered: boolean;
      installed_on_agent: boolean;
    }>(`/api/harness/skills`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  activateSkill: (name: string, args?: string) =>
    apiFetch<HarnessSkillActivation>(`/api/harness/skills/${name}/activate`, {
      method: "POST",
      body: JSON.stringify({ arguments: args }),
    }),
  listAgentSkills: (agentId: string) =>
    apiFetch<HarnessSkillInstallation[]>(`/api/harness/agents/${agentId}/skills`),
  installAgentSkill: (
    agentId: string,
    skillName: string,
    sourceUrl?: string,
    approvedPaths?: string[],
    approvedCommands?: string[],
  ) =>
    apiFetch<HarnessSkillInstallation>(`/api/harness/agents/${agentId}/skills`, {
      method: "POST",
      body: JSON.stringify({
        name: skillName,
        source_url: sourceUrl,
        approved_paths: approvedPaths ?? [],
        approved_commands: approvedCommands ?? [],
      }),
    }),
  uninstallAgentSkill: (agentId: string, skillName: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/skills/${skillName}`, {
      method: "DELETE",
    }),
  installFromShop: (name: string, category: string) =>
    apiFetch<{ name: string; path: string; installed: boolean }>(`/api/harness/skills/install-from-shop`, {
      method: "POST",
      body: JSON.stringify({ name, category }),
    }),
  getSkillContent: (category: string, name: string) =>
    apiFetch<string>(`/api/skills/${category}/${name}/content`),
};
