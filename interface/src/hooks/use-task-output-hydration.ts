import { useEffect } from "react";
import { api } from "../api/client";
import type { BuildStep, TestStep } from "../stores/event-store/index";
import { hydrateTaskOutputOnce } from "../stores/task-output-hydration-cache";
import type { Task } from "../types";

function mapBuildSteps(steps: { kind?: string; command?: string; stderr?: string; stdout?: string; attempt?: number; type?: string; reason?: string }[]): BuildStep[] {
  const kindMap: Record<string, BuildStep["kind"]> = {
    build_verification_skipped: "skipped",
    build_verification_started: "started",
    build_verification_passed: "passed",
    build_verification_failed: "failed",
    build_fix_attempt: "fix_attempt",
  };
  return steps.map((s) => {
    const raw = s as { type?: string; reason?: string };
    return {
      kind: (kindMap[raw.type ?? ""] ?? s.kind ?? "started") as BuildStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      reason: (raw.type === "build_verification_skipped" || s.kind === "skipped") ? (raw.reason ?? s.stdout) : undefined,
      timestamp: 0,
    };
  });
}

function mapTestSteps(steps: { kind?: string; command?: string; stderr?: string; stdout?: string; attempt?: number; tests?: { name: string; status: string; message?: string }[]; summary?: string; type?: string }[]): TestStep[] {
  const kindMap: Record<string, TestStep["kind"]> = {
    test_verification_started: "started",
    test_verification_passed: "passed",
    test_verification_failed: "failed",
    test_fix_attempt: "fix_attempt",
  };
  return steps.map((s) => {
    const raw = s as { type?: string };
    return {
      kind: (kindMap[raw.type ?? ""] ?? s.kind ?? "started") as TestStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      tests: s.tests ?? [],
      summary: s.summary,
      timestamp: 0,
    };
  });
}

/**
 * Hydrates task output from persisted data (inline on the task) or by
 * fetching from the API when needed.
 *
 * Hydration is deduplicated across all consumers of the same (projectId,
 * taskId) via the shared hydration cache, so rendering this hook from
 * many rows at once issues at most one HTTP request per task. Empty
 * server responses are treated as terminal "no output" and never blindly
 * retried; a subsequent `TaskStarted` event invalidates the cache so the
 * next mount will refetch.
 */
export function useTaskOutputHydration(
  projectId: string | undefined,
  task: Task,
  isActive: boolean,
  isTerminal: boolean,
  streamBuf: string,
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[]) => void,
): void {
  useEffect(() => {
    if (!projectId) return;
    if (streamBuf) return;

    const persistedBuildSteps = task.build_steps?.length
      ? mapBuildSteps(task.build_steps)
      : undefined;
    const persistedTestSteps = task.test_steps?.length
      ? mapTestSteps(task.test_steps)
      : undefined;

    if (!(isTerminal || isActive || task.status === "in_progress")) return;

    if (task.live_output || persistedBuildSteps?.length || persistedTestSteps?.length) {
      seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      return;
    }

    void hydrateTaskOutputOnce(projectId, task.task_id, async () => {
      try {
        const res = await api.getTaskOutput(projectId, task.task_id);
        const loadedBuildSteps = res.build_steps ? mapBuildSteps(res.build_steps) : undefined;
        const loadedTestSteps = res.test_steps ? mapTestSteps(res.test_steps) : undefined;
        if (res.output || loadedBuildSteps?.length || loadedTestSteps?.length) {
          seedTaskOutput(task.task_id, res.output, loadedBuildSteps, loadedTestSteps);
          return "loaded";
        }
        return "empty";
      } catch (err) {
        console.warn("Failed to load task output:", err);
        return "empty";
      }
    });
  }, [isActive, isTerminal, projectId, task.task_id, task.status, task.live_output, task.build_steps, task.test_steps, streamBuf, seedTaskOutput]);
}
