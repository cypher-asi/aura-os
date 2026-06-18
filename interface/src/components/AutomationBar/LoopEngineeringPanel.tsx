import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Button, Text } from "@cypher-asi/zui";
import { Plus, Trash2 } from "lucide-react";

import type {
  LoopEngineeringApprovalPolicy,
  LoopEngineeringContract,
  LoopEngineeringLearningPolicy,
  LoopEngineeringVerifierCommand,
} from "../../shared/api/loop";
import type { ProjectId } from "../../shared/types";
import styles from "./AutomationBar.module.css";

interface LoopEngineeringPanelProps {
  projectId: ProjectId;
  canStart: boolean;
  onStart: (contract: LoopEngineeringContract) => Promise<void>;
}

interface LoopEngineeringDraft {
  goal: string;
  successCriteriaText: string;
  verifierCommands: LoopEngineeringVerifierCommand[];
  maxIterations: number;
  approvalPolicy: LoopEngineeringApprovalPolicy;
  learning: LoopEngineeringLearningPolicy;
}

const DRAFT_KEY_PREFIX = "aura-loop-engineering-draft:project:";

const DEFAULT_DRAFT: LoopEngineeringDraft = {
  goal: "",
  successCriteriaText: [
    "Requested behavior works end to end",
    "Existing tests, build, or project-native smoke checks pass",
    "Final report includes evidence, changes, risks, and learnings",
  ].join("\n"),
  verifierCommands: [],
  maxIterations: 4,
  approvalPolicy: "apply_within_workspace",
  learning: {
    captureTrace: true,
    proposeEvals: true,
    proposeSkills: true,
    summarizeRegressions: true,
  },
};

export function LoopEngineeringPanel({
  projectId,
  canStart,
  onStart,
}: LoopEngineeringPanelProps) {
  const [draft, setDraft] = useState<LoopEngineeringDraft>(() =>
    loadDraft(projectId),
  );

  useEffect(() => {
    setDraft(loadDraft(projectId));
  }, [projectId]);

  useEffect(() => {
    persistDraft(projectId, draft);
  }, [projectId, draft]);

  const contract = useMemo(() => draftToContract(draft), [draft]);
  const canSubmit =
    canStart &&
    contract.goal.length > 0 &&
    contract.successCriteria.length > 0;

  const updateVerifier = (
    index: number,
    patch: Partial<LoopEngineeringVerifierCommand>,
  ) => {
    setDraft((current) => {
      const next = current.verifierCommands.map((command, i) =>
        i === index ? { ...command, ...patch } : command,
      );
      return { ...current, verifierCommands: next };
    });
  };

  const removeVerifier = (index: number) => {
    setDraft((current) => ({
      ...current,
      verifierCommands: current.verifierCommands.filter((_, i) => i !== index),
    }));
  };

  const addVerifier = () => {
    setDraft((current) => ({
      ...current,
      verifierCommands: [
        ...current.verifierCommands,
        { label: "", command: "", expectedOutcome: "" },
      ],
    }));
  };

  return (
    <div className={styles.loopEngineeringPanel}>
      <label className={styles.loopField}>
        <Text size="xs" className={styles.loopFieldLabel}>
          Goal
        </Text>
        <textarea
          className={styles.loopTextarea}
          value={draft.goal}
          onChange={(event) =>
            setDraft((current) => ({ ...current, goal: event.target.value }))
          }
          placeholder="Fix the broken flow, verify it, and capture learnings"
          rows={3}
        />
      </label>

      <label className={styles.loopField}>
        <Text size="xs" className={styles.loopFieldLabel}>
          Success criteria
        </Text>
        <textarea
          className={styles.loopTextarea}
          value={draft.successCriteriaText}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              successCriteriaText: event.target.value,
            }))
          }
          rows={3}
        />
      </label>

      <div className={styles.loopVerifierHeader}>
        <Text size="xs" className={styles.loopFieldLabel}>
          Verifier commands
        </Text>
        <Button
          variant="ghost"
          size="sm"
          icon={<Plus size={13} />}
          onClick={addVerifier}
          title="Add verifier"
          aria-label="Add verifier"
        />
      </div>

      <div className={styles.loopVerifierList}>
        {draft.verifierCommands.map((verifier, index) => (
          <div className={styles.loopVerifierRow} key={index}>
            <input
              className={styles.loopInput}
              aria-label={`Verifier ${index + 1} label`}
              value={verifier.label}
              onChange={(event) =>
                updateVerifier(index, { label: event.target.value })
              }
              placeholder="Tests"
            />
            <input
              className={styles.loopInput}
              aria-label={`Verifier ${index + 1} command`}
              value={verifier.command}
              onChange={(event) =>
                updateVerifier(index, { command: event.target.value })
              }
              placeholder="npm test -- --run"
            />
            <input
              className={styles.loopInput}
              aria-label={`Verifier ${index + 1} expected outcome`}
              value={verifier.expectedOutcome ?? ""}
              onChange={(event) =>
                updateVerifier(index, { expectedOutcome: event.target.value })
              }
              placeholder="All tests pass"
            />
            <Button
              variant="ghost"
              size="sm"
              iconOnly
              icon={<Trash2 size={13} />}
              onClick={() => removeVerifier(index)}
              title={`Remove verifier ${index + 1}`}
              aria-label={`Remove verifier ${index + 1}`}
            />
          </div>
        ))}
      </div>

      <div className={styles.loopOptions}>
        <label className={styles.loopInlineField}>
          <Text size="xs" className={styles.loopFieldLabel}>
            Iterations
          </Text>
          <input
            className={styles.loopNumberInput}
            type="number"
            min={1}
            max={12}
            value={draft.maxIterations}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                maxIterations: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className={styles.loopInlineField}>
          <Text size="xs" className={styles.loopFieldLabel}>
            Approval
          </Text>
          <select
            className={styles.loopSelect}
            value={draft.approvalPolicy}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                approvalPolicy:
                  event.target.value as LoopEngineeringApprovalPolicy,
              }))
            }
          >
            <option value="apply_within_workspace">Apply scoped fixes</option>
            <option value="propose_only">Propose only</option>
          </select>
        </label>
      </div>

      <div className={styles.loopLearningGrid}>
        <LoopLearningToggle
          label="Trace"
          checked={draft.learning.captureTrace}
          onChange={(captureTrace) => updateLearning(setDraft, { captureTrace })}
        />
        <LoopLearningToggle
          label="Evals"
          checked={draft.learning.proposeEvals}
          onChange={(proposeEvals) =>
            updateLearning(setDraft, { proposeEvals })
          }
        />
        <LoopLearningToggle
          label="Skills"
          checked={draft.learning.proposeSkills}
          onChange={(proposeSkills) =>
            updateLearning(setDraft, { proposeSkills })
          }
        />
        <LoopLearningToggle
          label="Regressions"
          checked={draft.learning.summarizeRegressions}
          onChange={(summarizeRegressions) =>
            updateLearning(setDraft, { summarizeRegressions })
          }
        />
      </div>

      <div className={styles.loopPanelFooter}>
        <Text size="xs" className={styles.loopMeta}>
          {contract.verifierCommands.length > 0
            ? `${contract.verifierCommands.length} verifier command${contract.verifierCommands.length === 1 ? "" : "s"}`
            : "Project-native verification will be discovered"}
        </Text>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void onStart(contract)}
          disabled={!canSubmit}
        >
          Start Loop Engineering
        </Button>
      </div>
    </div>
  );
}

function LoopLearningToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.loopToggle}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <Text size="xs">{label}</Text>
    </label>
  );
}

function updateLearning(
  setDraft: Dispatch<SetStateAction<LoopEngineeringDraft>>,
  patch: Partial<LoopEngineeringLearningPolicy>,
) {
  setDraft((current) => ({
    ...current,
    learning: { ...current.learning, ...patch },
  }));
}

function draftToContract(draft: LoopEngineeringDraft): LoopEngineeringContract {
  return {
    goal: draft.goal.trim(),
    successCriteria: draft.successCriteriaText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    verifierCommands: draft.verifierCommands
      .map((command) => ({
        label: command.label.trim(),
        command: command.command.trim(),
        expectedOutcome: command.expectedOutcome?.trim() || undefined,
      }))
      .filter((command) => command.command.length > 0),
    maxIterations: clampIterations(draft.maxIterations),
    approvalPolicy: draft.approvalPolicy,
    learning: draft.learning,
  };
}

function clampIterations(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_DRAFT.maxIterations;
  return Math.min(12, Math.max(1, Math.round(value)));
}

function loadDraft(projectId: ProjectId): LoopEngineeringDraft {
  try {
    const raw = localStorage.getItem(draftKey(projectId));
    if (!raw) return DEFAULT_DRAFT;
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return DEFAULT_DRAFT;
  }
}

function persistDraft(projectId: ProjectId, draft: LoopEngineeringDraft): void {
  try {
    localStorage.setItem(draftKey(projectId), JSON.stringify(draft));
  } catch {
    // localStorage may be unavailable.
  }
}

function normalizeDraft(value: unknown): LoopEngineeringDraft {
  if (value == null || typeof value !== "object") return DEFAULT_DRAFT;
  const draft = value as Partial<LoopEngineeringDraft>;
  return {
    goal: typeof draft.goal === "string" ? draft.goal : DEFAULT_DRAFT.goal,
    successCriteriaText:
      typeof draft.successCriteriaText === "string"
        ? draft.successCriteriaText
        : DEFAULT_DRAFT.successCriteriaText,
    verifierCommands: Array.isArray(draft.verifierCommands)
      ? draft.verifierCommands.filter(isVerifierCommand)
      : DEFAULT_DRAFT.verifierCommands,
    maxIterations:
      typeof draft.maxIterations === "number"
        ? clampIterations(draft.maxIterations)
        : DEFAULT_DRAFT.maxIterations,
    approvalPolicy:
      draft.approvalPolicy === "propose_only" ||
      draft.approvalPolicy === "apply_within_workspace"
        ? draft.approvalPolicy
        : DEFAULT_DRAFT.approvalPolicy,
    learning: normalizeLearning(draft.learning),
  };
}

function normalizeLearning(value: unknown): LoopEngineeringLearningPolicy {
  if (value == null || typeof value !== "object") return DEFAULT_DRAFT.learning;
  const learning = value as Partial<LoopEngineeringLearningPolicy>;
  return {
    captureTrace:
      typeof learning.captureTrace === "boolean"
        ? learning.captureTrace
        : DEFAULT_DRAFT.learning.captureTrace,
    proposeEvals:
      typeof learning.proposeEvals === "boolean"
        ? learning.proposeEvals
        : DEFAULT_DRAFT.learning.proposeEvals,
    proposeSkills:
      typeof learning.proposeSkills === "boolean"
        ? learning.proposeSkills
        : DEFAULT_DRAFT.learning.proposeSkills,
    summarizeRegressions:
      typeof learning.summarizeRegressions === "boolean"
        ? learning.summarizeRegressions
        : DEFAULT_DRAFT.learning.summarizeRegressions,
  };
}

function isVerifierCommand(value: unknown): value is LoopEngineeringVerifierCommand {
  if (value == null || typeof value !== "object") return false;
  const command = value as Partial<LoopEngineeringVerifierCommand>;
  return (
    typeof command.label === "string" &&
    typeof command.command === "string" &&
    (command.expectedOutcome == null ||
      typeof command.expectedOutcome === "string")
  );
}

function draftKey(projectId: ProjectId): string {
  return `${DRAFT_KEY_PREFIX}${projectId}`;
}
