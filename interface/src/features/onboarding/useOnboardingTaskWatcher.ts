import { useEffect } from "react";
import { useOnboardingStore } from "./onboarding-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useAura3DStore } from "../../stores/aura3d-store";
import { useMessageStore } from "../../stores/message-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { track } from "../../lib/analytics";
import { ONBOARDING_TASKS } from "./onboarding-constants";

const TOTAL = ONBOARDING_TASKS.length;

function progressLabel(completed: number): string {
  return `${completed}/${TOTAL}`;
}

/**
 * Mounted once in AppContent. Subscribes to relevant stores and
 * auto-detects onboarding task completion. All detection logic
 * lives here — no completeTask() calls scattered across the codebase.
 */
export function useOnboardingTaskWatcher(): void {
  useEffect(() => {
    const unsubs: (() => void)[] = [];

    // ── send_message: watch for any user message appended ──
    unsubs.push(
      useMessageStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.send_message) return;
        // Check if any thread has new messages compared to previous state
        for (const key of Object.keys(state.orderedIds)) {
          const curr = state.orderedIds[key]?.length ?? 0;
          const prevLen = prev.orderedIds[key]?.length ?? 0;
          if (curr > prevLen) {
            // Check if the new message is from the user
            const newIds = state.orderedIds[key].slice(prevLen);
            for (const id of newIds) {
              const msg = state.messages[id];
              if (msg && "role" in msg && msg.role === "user") {
                useOnboardingStore.getState().completeTask("send_message");
                const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
                track("onboarding_task_completed", { task_id: "send_message", progress: progressLabel(completed) });
                if (completed >= TOTAL) track("onboarding_completed");
                return;
              }
            }
          }
        }
      }),
    );

    // ── create_project: only detect projects created beyond the initial load ──
    let projectBaseline: number | null = null;
    unsubs.push(
      useProjectsListStore.subscribe((state) => {
        if (useOnboardingStore.getState().checklistTasks.create_project) return;
        if (projectBaseline === null) {
          projectBaseline = state.projects.length;
          return;
        }
        if (state.projects.length > projectBaseline) {
          useOnboardingStore.getState().completeTask("create_project");
          const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
          track("onboarding_task_completed", { task_id: "create_project", progress: progressLabel(completed) });
          if (completed >= TOTAL) track("onboarding_completed");
        }
      }),
    );

    // ── create_agent: only detect agents created beyond the initial load ──
    let agentBaseline: number | null = null;
    unsubs.push(
      useAgentStore.subscribe((state) => {
        if (useOnboardingStore.getState().checklistTasks.create_agent) return;
        if (agentBaseline === null) {
          agentBaseline = state.agents.length;
          return;
        }
        if (state.agents.length > agentBaseline) {
          useOnboardingStore.getState().completeTask("create_agent");
          const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
          track("onboarding_task_completed", { task_id: "create_agent", progress: progressLabel(completed) });
          if (completed >= TOTAL) track("onboarding_completed");
        }
      }),
    );

    // ── try_3d: watch for completed image generation ──
    unsubs.push(
      useAura3DStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.try_3d) return;
        if (state.images.length > prev.images.length) {
          useOnboardingStore.getState().completeTask("try_3d");
          const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
          track("onboarding_task_completed", { task_id: "try_3d", progress: progressLabel(completed) });
          if (completed >= TOTAL) track("onboarding_completed");
        }
      }),
    );

    // ── view_billing: watch for billing section opened ──
    unsubs.push(
      useUIModalStore.subscribe((state) => {
        if (useOnboardingStore.getState().checklistTasks.view_billing) return;
        if (state.orgSettingsOpen && state.orgInitialSection === "billing") {
          useOnboardingStore.getState().completeTask("view_billing");
          const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
          track("onboarding_task_completed", { task_id: "view_billing", progress: progressLabel(completed) });
          if (completed >= TOTAL) track("onboarding_completed");
        }
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, []);
}
