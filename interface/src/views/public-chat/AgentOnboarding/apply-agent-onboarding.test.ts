import { describe, expect, it } from "vitest";
import {
  applyAgentOnboarding,
  type ApplyOnboardingApi,
  type CeoOnboardingPatch,
} from "./apply-agent-onboarding";
import { emptyDraft, type AgentOnboardingDraft } from "./agent-onboarding-store";
import type { AgentId } from "../../../shared/types";

const CEO_ID = "ceo-1" as AgentId;

function draftWith(overrides: Partial<AgentOnboardingDraft>): AgentOnboardingDraft {
  return { ...emptyDraft(), ...overrides };
}

describe("applyAgentOnboarding", () => {
  it("configures the CEO with remote runtime, expertise, and installs skills", async () => {
    const updates: { id: AgentId; patch: CeoOnboardingPatch }[] = [];
    const installs: string[] = [];
    const api: ApplyOnboardingApi = {
      ensureCeo: async () => ({ agent_id: CEO_ID }),
      updateAgent: async (id, patch) => {
        updates.push({ id, patch });
      },
      installSkill: async (_id, name) => {
        installs.push(name);
      },
    };

    const result = await applyAgentOnboarding(
      draftWith({ personality: "Sharp", avatar: "/a.png", skills: ["github", "tavily"] }),
      api,
    );

    expect(result.agentId).toBe(CEO_ID);
    expect(updates).toHaveLength(1);
    expect(updates[0].patch.machine_type).toBe("remote");
    expect(updates[0].patch.environment).toBe("swarm_microvm");
    expect(updates[0].patch.adapter_type).toBe("aura_harness");
    expect(updates[0].patch.personality).toBe("Sharp");
    expect(updates[0].patch.icon).toBe("/a.png");
    expect(updates[0].patch.skills).toEqual(["github", "tavily"]);
    // github -> coding, tavily -> research (popular group is excluded)
    expect(updates[0].patch.expertise).toEqual(expect.arrayContaining(["coding", "research"]));
    expect(updates[0].patch.expertise).not.toContain("popular");
    expect(installs).toEqual(["github", "tavily"]);
    expect(result.skillsInstalled).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it("returns early when the CEO cannot be ensured", async () => {
    const api: ApplyOnboardingApi = {
      ensureCeo: async () => null,
      updateAgent: async () => {
        throw new Error("should not be called");
      },
      installSkill: async () => {
        throw new Error("should not be called");
      },
    };

    const result = await applyAgentOnboarding(draftWith({ skills: ["github"] }), api);

    expect(result.agentId).toBeNull();
    expect(result.skillsInstalled).toBe(0);
    // A null CEO (without a thrown error) is a clean no-op, not an error.
    expect(result.errors).toHaveLength(0);
  });

  it("records an error when ensuring the CEO throws", async () => {
    const api: ApplyOnboardingApi = {
      ensureCeo: async () => {
        throw new Error("setup failed");
      },
      updateAgent: async () => {},
      installSkill: async () => {},
    };

    const result = await applyAgentOnboarding(draftWith({}), api);

    expect(result.agentId).toBeNull();
    expect(result.errors.some((e) => e.includes("ensure CEO"))).toBe(true);
  });

  it("is best-effort: records failures but still installs the other skills", async () => {
    const installs: string[] = [];
    const api: ApplyOnboardingApi = {
      ensureCeo: async () => ({ agent_id: CEO_ID }),
      updateAgent: async () => {
        throw new Error("update boom");
      },
      installSkill: async (_id, name) => {
        if (name === "github") throw new Error("nope");
        installs.push(name);
      },
    };

    const result = await applyAgentOnboarding(draftWith({ skills: ["github", "tavily"] }), api);

    expect(result.errors.some((e) => e.includes("update CEO"))).toBe(true);
    expect(result.errors.some((e) => e.includes("install skill github"))).toBe(true);
    expect(installs).toEqual(["tavily"]);
    expect(result.skillsInstalled).toBe(1);
  });
});
