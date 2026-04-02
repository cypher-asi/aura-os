import type { HarnessSkill, HarnessSkillActivation, HarnessSkillInstallation } from "../types";
import { apiFetch } from "./core";

export const harnessSkillsApi = {
  listSkills: () =>
    apiFetch<HarnessSkill[]>(`/api/harness/skills`),
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
  }) =>
    apiFetch<{ name: string; path: string; created: boolean }>(`/api/harness/skills`, {
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
  installAgentSkill: (agentId: string, skillName: string, sourceUrl?: string) =>
    apiFetch<HarnessSkillInstallation>(`/api/harness/agents/${agentId}/skills`, {
      method: "POST",
      body: JSON.stringify({ name: skillName, source_url: sourceUrl }),
    }),
  uninstallAgentSkill: (agentId: string, skillName: string) =>
    apiFetch<void>(`/api/harness/agents/${agentId}/skills/${skillName}`, {
      method: "DELETE",
    }),
  installFromShop: (name: string, sourceUrl: string) =>
    apiFetch<{ name: string; path: string; installed: boolean }>(`/api/harness/skills/install-from-shop`, {
      method: "POST",
      body: JSON.stringify({ name, source_url: sourceUrl }),
    }),
};
