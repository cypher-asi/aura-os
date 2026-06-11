import type { AgentId } from "../../../shared/types";
import type { AgentOnboardingDraft } from "./agent-onboarding-store";
import { deriveExpertiseFromSkills, skillSourceUrl } from "./onboarding-data";

/**
 * Patch applied to the CEO super-agent. We force the remote runtime and never
 * touch `name`/`role` so the agent stays identifiable as the CEO super-agent
 * (`isSuperAgent` requires both to be "ceo").
 */
export interface CeoOnboardingPatch {
  readonly personality?: string;
  readonly icon?: string;
  readonly expertise?: string[];
  readonly skills?: string[];
  readonly machine_type: "remote";
  readonly environment: "swarm_microvm";
  readonly adapter_type: "aura_harness";
  readonly auth_source: "aura_managed";
}

/** Thin api surface so the orchestration stays pure + unit-testable. */
export interface ApplyOnboardingApi {
  /** Idempotently ensure the canonical CEO exists; returns it (or null). */
  ensureCeo: () => Promise<{ agent_id: AgentId } | null>;
  updateAgent: (agentId: AgentId, patch: CeoOnboardingPatch) => Promise<void>;
  installSkill: (agentId: AgentId, name: string, sourceUrl?: string) => Promise<void>;
}

export interface ApplyOnboardingResult {
  readonly agentId: AgentId | null;
  readonly skillsInstalled: number;
  readonly errors: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Configure the user's CEO super-agent from an onboarding draft, forcing it to
 * be a remote-only agent. Best-effort: a failure in any individual step is
 * recorded but never aborts the rest, so the user always lands in the app.
 *
 * Integrations / messaging / automations selections are intentionally NOT
 * applied here — they require an authenticated OAuth/linking flow and are
 * surfaced as post-signup prompts instead.
 */
export async function applyAgentOnboarding(
  draft: AgentOnboardingDraft,
  api: ApplyOnboardingApi,
): Promise<ApplyOnboardingResult> {
  const errors: string[] = [];

  let ceo: { agent_id: AgentId } | null = null;
  try {
    ceo = await api.ensureCeo();
  } catch (error) {
    errors.push(`ensure CEO: ${errorMessage(error)}`);
  }

  if (!ceo) {
    return { agentId: null, skillsInstalled: 0, errors };
  }

  const expertise = deriveExpertiseFromSkills(draft.skills);
  const patch: CeoOnboardingPatch = {
    ...(draft.personality.trim() ? { personality: draft.personality.trim() } : {}),
    ...(draft.avatar ? { icon: draft.avatar } : {}),
    ...(expertise.length > 0 ? { expertise: [...expertise] } : {}),
    ...(draft.skills.length > 0 ? { skills: [...draft.skills] } : {}),
    machine_type: "remote",
    environment: "swarm_microvm",
    adapter_type: "aura_harness",
    auth_source: "aura_managed",
  };

  try {
    await api.updateAgent(ceo.agent_id, patch);
  } catch (error) {
    errors.push(`update CEO: ${errorMessage(error)}`);
  }

  let skillsInstalled = 0;
  for (const name of draft.skills) {
    try {
      await api.installSkill(ceo.agent_id, name, skillSourceUrl(name));
      skillsInstalled += 1;
    } catch (error) {
      errors.push(`install skill ${name}: ${errorMessage(error)}`);
    }
  }

  return { agentId: ceo.agent_id, skillsInstalled, errors };
}
