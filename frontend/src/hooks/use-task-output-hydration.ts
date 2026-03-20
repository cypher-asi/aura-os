import { useEffect, useRef } from "react";
import { api } from "../api/client";
import type { BuildStep, TestStep } from "../context/EventContext";
import type { Task } from "../types";

/**
 * Hydrates task output from persisted data (inline on the task) or by
 * fetching from the API when needed. Ensures we only hydrate once per task.
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

    const persistedBuildSteps = task.build_steps?.map((s) => ({
      kind: s.kind as BuildStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      reason: s.kind === "skipped" ? (s.stdout ?? undefined) : undefined,
      timestamp: 0,
    }));

    const persistedTestSteps = task.test_steps?.map((s) => ({
      kind: s.kind as TestStep["kind"],
      command: s.command,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      tests: s.tests ?? [],
      summary: s.summary,
      timestamp: 0,
    }));

    if (isTerminal || isActive || task.status === "in_progress") {
      if (task.live_output || persistedBuildSteps?.length || persistedTestSteps?.length) {
        hydratedRef.current = task.task_id;
        seedTaskOutput(task.task_id, task.live_output, persistedBuildSteps, persistedTestSteps);
      } else {
        hydratedRef.current = task.task_id;
        api.getTaskOutput(projectId, task.task_id).then((res) => {
          if (cancelled) return;
          const buildKindMap: Record<string, BuildStep["kind"]> = {
            build_verification_skipped: "skipped",
            build_verification_started: "started",
            build_verification_passed: "passed",
            build_verification_failed: "failed",
            build_fix_attempt: "fix_attempt",
          };
          const testKindMap: Record<string, TestStep["kind"]> = {
            test_verification_started: "started",
            test_verification_passed: "passed",
            test_verification_failed: "failed",
            test_fix_attempt: "fix_attempt",
          };
          const loadedBuildSteps = res.build_steps?.map((s) => {
            const raw = s as unknown as { type?: string; reason?: string };
            return {
              kind: (buildKindMap[raw.type ?? ""] ?? s.kind ?? "started") as BuildStep["kind"],
              command: s.command,
              stderr: s.stderr,
              stdout: s.stdout,
              attempt: s.attempt,
              reason: (raw.type === "build_verification_skipped" || s.kind === "skipped") ? (raw.reason ?? s.stdout) : undefined,
              timestamp: 0,
            };
          });
          const loadedTestSteps = res.test_steps?.map((s) => {
            const raw = s as unknown as { type?: string };
            return {
              kind: (testKindMap[raw.type ?? ""] ?? s.kind ?? "started") as TestStep["kind"],
              command: s.command,
              stderr: s.stderr,
              stdout: s.stdout,
              attempt: s.attempt,
              tests: s.tests ?? [],
              summary: s.summary,
              timestamp: 0,
            };
          });
          if (res.output || loadedBuildSteps?.length || loadedTestSteps?.length) {
            seedTaskOutput(task.task_id, res.output, loadedBuildSteps, loadedTestSteps);
          }
        }).catch((err) => console.warn("Failed to load task output:", err));
      }
    }

    return () => { cancelled = true; };
  }, [isActive, isTerminal, projectId, task.task_id, task.status, task.live_output, task.build_steps, task.test_steps, streamBuf, seedTaskOutput]);
}
