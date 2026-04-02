import type { HarnessSkill, HarnessSkillActivation } from "../types";
import { apiFetch } from "./core";

export const harnessSkillsApi = {
  listSkills: () =>
    apiFetch<HarnessSkill[]>(`/api/harness/skills`),
  getSkill: (name: string) =>
    apiFetch<HarnessSkill>(`/api/harness/skills/${name}`),
  activateSkill: (name: string, args?: string) =>
    apiFetch<HarnessSkillActivation>(`/api/harness/skills/${name}/activate`, {
      method: "POST",
      body: JSON.stringify({ arguments: args }),
    }),
};
