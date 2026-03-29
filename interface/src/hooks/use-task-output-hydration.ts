import { useEffect, useRef } from "react";
import { api } from "../api/client";
import type { BuildStep, TestStep } from "../stores/event-store";
import type { Task } from "../types";

const CATCHUP_DELAY_MS = 2000;

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

function fetchAndSeed(
  projectId: string,
  taskId: string,
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[]) => void,
): Promise<boolean> {
  return api.getTaskOutput(projectId, taskId).then((res) => {
    const loadedBuildSteps = res.build_steps ? mapBuildSteps(res.build_steps) : undefined;
    const loadedTestSteps = res.test_steps ? mapTestSteps(res.test_steps) : undefined;
    if (res.output || loadedBuildSteps?.length || loadedTestSteps?.length) {
      seedTaskOutput(taskId, res.output, loadedBuildSteps, loadedTestSteps);
      return true;
    }
    return false;
  }).catch((err) => { console.warn("Failed to load task output:", err); return false; });
}

/**
 * Hydrates task output from persisted data (inline on the task) or by
 * fetching from the API when needed. For in-progress tasks, retries once
 * after a short delay if the first fetch returned empty (server cache may
 * still be filling).
 */
export function useTaskOutputHydration(
  projectId: string | undefined,
  task: Task,
  isActive: boolean,
  isTerminal: boolean,
  streamBuf: string,
  seedTaskOutput: (taskId: string, text: string, buildSteps?: BuildStep[], testSteps?: TestStep[]) => void,
): void {
  const hydratedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    if (streamBuf || hydratedRef.current === task.task_id) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const persistedBuildSteps = task.build_steps?.length
      ? mapBuildSteps(task.build_steps)
      : undefined;
    const persistedTestSteps = task.test_steps?.length
      ? mapTestSteps(task.test_steps)
      : undefined;

    if (isTerminal || isActive || task.status === "in_progress") {
      if (task.live_output || persistedBuildSteps?.length || persistedTestSteps?.length) {
        hydratedRef.current = task.task_id;
        seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      } else {
        hydratedRef.current = task.task_id;
        fetchAndSeed(projectId, task.task_id, seedTaskOutput).then((seeded) => {
          if (cancelled) return;
          if (!seeded && isActive) {
            retryTimer = setTimeout(() => {
              if (cancelled) return;
              fetchAndSeed(projectId, task.task_id, seedTaskOutput);
            }, CATCHUP_DELAY_MS);
          }
        });
      }
    }

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isActive, isTerminal, projectId, task.task_id, task.status, task.live_output, task.build_steps, task.test_steps, streamBuf, seedTaskOutput]);
}
