import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import { useAuth } from "../../../stores/auth-store";
import { useAgentOnboardingStore } from "./agent-onboarding-store";
import { applyAgentOnboarding } from "./apply-agent-onboarding";

/**
 * Mounted once in the authenticated shell. When a visitor finishes the agent
 * onboarding wizard and then signs up (or was already signed in), this applies
 * their draft to the CEO super-agent and routes them to their chat.
 */
export function useApplyAgentOnboarding(): void {
  const { isAuthenticated } = useAuth();
  const pendingApply = useAgentOnboardingStore((s) => s.pendingApply);
  const consumePendingDraft = useAgentOnboardingStore((s) => s.consumePendingDraft);
  const navigate = useNavigate();
  const running = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !pendingApply || running.current) return;

    const draft = consumePendingDraft();
    if (!draft) return;

    running.current = true;
    void (async () => {
      try {
        await applyAgentOnboarding(draft, {
          ensureCeo: async () => {
            const { agent } = await api.superAgent.setup();
            return agent;
          },
          updateAgent: async (agentId, patch) => {
            await api.agents.update(agentId, patch);
          },
          installSkill: async (agentId, name, sourceUrl) => {
            await api.harnessSkills.installAgentSkill(agentId, name, sourceUrl);
          },
        });
        const { track } = await import("../../../lib/analytics");
        track("onboarding_agent_configured");
      } catch {
        // Best-effort: never block the user from entering the app.
      } finally {
        navigate("/");
        running.current = false;
      }
    })();
  }, [isAuthenticated, pendingApply, consumePendingDraft, navigate]);
}
