import { useEffect } from "react";
import { useOnboardingStore } from "./onboarding-store";
import { useProjectsListStore } from "../../stores/projects-list-store";
import { useAgentStore } from "../../apps/agents/stores/agent-store";
import { useAura3DStore } from "../../stores/aura3d-store";
import { useMessageStore } from "../../stores/message-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useStreamStore } from "../../hooks/stream/store";
import { track } from "../../lib/analytics";
import { ONBOARDING_TASKS } from "./onboarding-constants";

const TOTAL = ONBOARDING_TASKS.length;

function progressLabel(completed: number): string {
  return `${completed}/${TOTAL}`;
}

function completeOnboardingTask(taskId: string): void {
  useOnboardingStore.getState().completeTask(taskId);
  const completed = Object.values(useOnboardingStore.getState().checklistTasks).filter(Boolean).length;
  track("onboarding_task_completed", { task_id: taskId, progress: progressLabel(completed) });
  if (completed >= TOTAL) track("onboarding_completed");
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
                completeOnboardingTask("send_message");
                return;
              }
            }
          }
        }
      }),
    );

    unsubs.push(
      useStreamStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.send_message) return;
        for (const key of Object.keys(state.entries)) {
          const curr = state.entries[key]?.events ?? [];
          const prevLen = prev.entries[key]?.events.length ?? 0;
          if (curr.length <= prevLen) continue;
          const newEvents = curr.slice(prevLen);
          if (newEvents.some((event) => "role" in event && event.role === "user")) {
            completeOnboardingTask("send_message");
            return;
          }
        }
      }),
    );

    // ── create_project: detect when user creates a project (count exceeds 1, since org setup may create one) ──
    unsubs.push(
      useProjectsListStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.create_project) return;
        if (state.projects.length > prev.projects.length && prev.projects.length >= 1) {
          completeOnboardingTask("create_project");
        }
      }),
    );

    // ── create_agent: detect when user creates an agent (count exceeds 1, since a default CEO agent exists) ──
    unsubs.push(
      useAgentStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.create_agent) return;
        if (state.agents.length > prev.agents.length && prev.agents.length >= 1) {
          completeOnboardingTask("create_agent");
        }
      }),
    );

    // ── try_3d: watch for completed image generation ──
    unsubs.push(
      useAura3DStore.subscribe((state, prev) => {
        if (useOnboardingStore.getState().checklistTasks.try_3d) return;
        if (state.images.length > prev.images.length) {
          completeOnboardingTask("try_3d");
        }
      }),
    );

    // ── view_billing: watch for billing section opened ──
    unsubs.push(
      useUIModalStore.subscribe((state) => {
        if (useOnboardingStore.getState().checklistTasks.view_billing) return;
        if (state.orgSettingsOpen && state.orgInitialSection === "billing") {
          completeOnboardingTask("view_billing");
        }
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, []);
}
