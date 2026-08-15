import type { HarnessSkill, HarnessSkillActivation, HarnessSkillInstallation } from "../types";
import { apiFetch } from "./core";

export interface SkillAgentTargetBinding {
  agent_id: string;
  name: string;
}

export interface MySkillEntry {
  name: string;
  description: string;
  path: string;
  user_invocable: boolean;
  model_invocable: boolean;
}

/** Full detail for editing a user-authored skill (from `GET /skills/mine/:name`). */
export interface MySkillDetail {
  name: string;
  description: string;
  body: string;
  user_invocable: boolean;
  model_invocable: boolean;
  allowed_tools?: string[];
  model?: string;
  context?: string;
  agent_target?: SkillAgentTargetBinding;
}

/** Entry in the 409 response body from `DELETE /api/harness/skills/mine/:name`. */
export interface SkillInstalledAgentRef {
  agent_id: string;
  name: string;
}

export interface SkillRecordingFrame {
  media_type: "image/png" | "image/jpeg";
  data: string;
}

export interface RecordedSkillDraft {
  name: string;
  description: string;
  body: string;
}

export const harnessSkillsApi = {
  analyzeRecording: (data: {
    goal: string;
    notes?: string;
    agent_id?: string;
    frames: SkillRecordingFrame[];
  }) =>
    apiFetch<RecordedSkillDraft>(`/api/harness/skills/recording/analyze`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listSkills: () =>
    apiFetch<HarnessSkill[]>(`/api/harness/skills`),
  listMySkills: () =>
    apiFetch<MySkillEntry[]>(`/api/harness/skills/mine`),
  /**
   * Full detail for editing a user-authored skill, read from its on-disk
   * marker file so every field (user_invocable / model_invocable /
   * allowed_tools / model / context) round-trips faithfully. The generic
   * getSkill is harness-backed and drops several of these, so the edit modal
   * must use this. Rejects with `ApiClientError` 404 (no such user skill) or
   * 403 (not user-created).
   */
  getMySkill: (name: string) =>
    apiFetch<MySkillDetail>(`/api/harness/skills/mine/${name}`),
  /**
   * Permanently delete a user-authored skill.
   *
   * Rejects with `ApiClientError` (status 409) when the skill is still
   * installed on any local agent. In that case `err.body` carries
   * `{ error: "installed_on_agents", agents: SkillInstalledAgentRef[] }`
   * so the UI can tell the user exactly which agents are blocking the
   * delete.
   */
  deleteMySkill: (name: string) =>
    apiFetch<{ name: string; deleted: boolean }>(`/api/harness/skills/mine/${name}`, {
      method: "DELETE",
    }),
  /**
   * Rewrite an existing user-authored skill's SKILL.md (frontmatter +
   * body). Only `description` is required; any omitted optional field is
   * re-rendered as absent, so callers must round-trip `allowed_tools` /
   * `model` / `context` they want to preserve. Rejects with
   * `ApiClientError` 404 (no such user skill) or 403 (not user-created).
   */
  updateMySkill: (
    name: string,
    data: {
      description: string;
      body?: string;
      allowed_tools?: string[];
      model?: string;
      context?: string;
      user_invocable?: boolean;
      model_invocable?: boolean;
      agent_target?: SkillAgentTargetBinding;
    },
  ) =>
    apiFetch<{ name: string; path: string; updated: boolean }>(`/api/harness/skills/mine/${name}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
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
    agent_target?: SkillAgentTargetBinding;
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
