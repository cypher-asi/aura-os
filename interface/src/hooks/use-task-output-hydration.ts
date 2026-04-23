import { useEffect } from "react";
import { api } from "../api/client";
import type { BuildStep, TestStep } from "../stores/event-store/index";
import { hydrateTaskOutputOnce } from "../stores/task-output-hydration-cache";
import type { Task } from "../types";

// Persisted `build_steps` / `test_steps` on the server mix two shapes:
//   1. Native `build_verification_*` / `test_verification_*` events with
//      the command at the top level.
//   2. Raw `tool_call_snapshot` / `tool_call_completed` events that the
//      dev loop classifies as build/test/format/lint work via
//      `classify_run_command_steps` in `apps/aura-os-server/.../dev_loop.rs`.
//      Those store the command under `input` (mirror of the Rust
//      `extract_run_command` helper).
// This module normalises both into the `BuildStep` / `TestStep` shape the
// UI expects so rows never render as "Running `undefined`".

interface PersistedStepShape {
  kind?: string;
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  type?: string;
  reason?: string;
  name?: string;
  id?: string;
  tests?: { name: string; status: string; message?: string }[];
  summary?: string;
  input?: unknown;
}

function extractRunCommand(step: PersistedStepShape): string | undefined {
  if (step.name !== "run_command") return undefined;
  const input = step.input;
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  const raw = obj.command;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  const program = obj.program;
  if (typeof program !== "string" || !program.trim()) return undefined;
  const args = Array.isArray(obj.args)
    ? obj.args.filter((v): v is string => typeof v === "string")
    : [];
  return args.length === 0 ? program.trim() : `${program.trim()} ${args.join(" ")}`;
}

// Collapse snapshot/completed pairs for the same tool call id so each
// command surfaces as a single row. When both exist we keep the
// `completed` event (it represents the final state).
function dedupeToolCallPairs(steps: PersistedStepShape[]): PersistedStepShape[] {
  const completedIds = new Set<string>();
  for (const s of steps) {
    if (s.type === "tool_call_completed" && typeof s.id === "string") {
      completedIds.add(s.id);
    }
  }
  return steps.filter(
    (s) => !(s.type === "tool_call_snapshot" && typeof s.id === "string" && completedIds.has(s.id)),
  );
}

function mapBuildSteps(steps: PersistedStepShape[]): BuildStep[] {
  const kindMap: Record<string, BuildStep["kind"]> = {
    build_verification_skipped: "skipped",
    build_verification_started: "started",
    build_verification_passed: "passed",
    build_verification_failed: "failed",
    build_fix_attempt: "fix_attempt",
    tool_call_snapshot: "started",
    tool_call_completed: "passed",
  };
  return dedupeToolCallPairs(steps).map((s) => {
    const type = s.type ?? "";
    const toolCommand = extractRunCommand(s);
    return {
      kind: (kindMap[type] ?? s.kind ?? "started") as BuildStep["kind"],
      command: s.command ?? toolCommand,
      stderr: s.stderr,
      stdout: s.stdout,
      attempt: s.attempt,
      reason: (type === "build_verification_skipped" || s.kind === "skipped") ? (s.reason ?? s.stdout) : undefined,
      timestamp: 0,
    };
  });
}

function mapTestSteps(steps: PersistedStepShape[]): TestStep[] {
  const kindMap: Record<string, TestStep["kind"]> = {
    test_verification_started: "started",
    test_verification_passed: "passed",
    test_verification_failed: "failed",
    test_fix_attempt: "fix_attempt",
    tool_call_snapshot: "started",
    tool_call_completed: "passed",
  };
  return dedupeToolCallPairs(steps).map((s) => {
    const type = s.type ?? "";
    const toolCommand = extractRunCommand(s);
    return {
      kind: (kindMap[type] ?? s.kind ?? "started") as TestStep["kind"],
      command: s.command ?? toolCommand,
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
