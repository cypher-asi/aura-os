import { useState, useEffect } from "react";
import { Check, Loader2, MinusCircle, SkipForward, Wrench, XCircle } from "lucide-react";
import type { BuildStep, TestStep } from "../../stores/event-store/index";
import styles from "../Preview/Preview.module.css";

type VerificationVariant = "build" | "test";

type VerificationStep = {
  kind: "started" | "passed" | "failed" | "fix_attempt" | "skipped";
  command?: string;
  stderr?: string;
  stdout?: string;
  attempt?: number;
  reason?: string;
  tests?: { name: string; status: string; message?: string }[];
  summary?: string;
};

function StepIcon({ kind, active }: { kind: VerificationStep["kind"]; active: boolean }) {
  switch (kind) {
    case "started":
      return active ? <Loader2 size={12} className={styles.spinner} /> : <Check size={12} />;
    case "passed":
      return <Check size={12} />;
    case "failed":
      return <XCircle size={12} />;
    case "fix_attempt":
      return active ? <Wrench size={12} className={styles.spinner} /> : <Wrench size={12} />;
    case "skipped":
      return <SkipForward size={12} />;
  }
}

function TestResultIcon({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <Check size={12} className={styles.testPassed} />;
    case "failed":
      return <XCircle size={12} className={styles.testFailed} />;
    case "skipped":
      return <MinusCircle size={12} className={styles.testSkipped} />;
    default:
      return <MinusCircle size={12} />;
  }
}

function getStepLabel(variant: VerificationVariant, step: VerificationStep, active: boolean): string {
  switch (step.kind) {
    case "started": {
      const prefix = variant === "test" ? `Running tests \`${step.command}\`` : `Running \`${step.command}\``;
      return active ? `${prefix}...` : prefix;
    }
    case "passed":
      if (variant === "test") return step.summary ? `Tests passed (${step.summary})` : "Tests passed";
      return "Build passed";
    case "failed":
      if (variant === "test") {
        return `Tests failed${step.attempt ? ` (attempt ${step.attempt})` : ""}${step.summary ? ` — ${step.summary}` : ""}`;
      }
      return `Build failed${step.attempt ? ` (attempt ${step.attempt})` : ""}`;
    case "fix_attempt": {
      const base = `Attempting auto-fix${step.attempt ? ` (attempt ${step.attempt})` : ""}`;
      return active ? `${base}...` : base;
    }
    case "skipped":
      return step.reason ? `Build verification skipped — ${step.reason}` : "Build verification skipped";
  }
}

export function VerificationStepItem({
  step,
  active,
  variant,
}: {
  step: BuildStep | TestStep;
  active: boolean;
  variant: VerificationVariant;
}) {
  const [expanded, setExpanded] = useState(step.kind === "failed");

  useEffect(() => {
    setExpanded(step.kind === "failed");
  }, [step.kind]);

  const statusClass =
    step.kind === "passed" ? styles.buildPassed :
    step.kind === "failed" ? styles.buildFailed :
    step.kind === "skipped" ? styles.buildSkipped : "";

  const hasOutput = !!(step.stderr || step.stdout);
  const label = getStepLabel(variant, step as VerificationStep, active);
  const tests = "tests" in step ? step.tests : undefined;

  return (
    <div className={`${styles.activityItem} ${statusClass}`}>
      <span className={styles.activityIcon}>
        <StepIcon kind={step.kind} active={active} />
      </span>
      <span className={styles.activityBody}>
        <span className={styles.activityMessage}>{label}</span>
        {hasOutput && (
          <button
            className={styles.buildToggle}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Hide output" : "Show output"}
          </button>
        )}
        {expanded && step.stderr && (
          <pre className={styles.buildOutput}>{step.stderr}</pre>
        )}
        {expanded && step.stdout && (
          <pre className={styles.buildOutput}>{step.stdout}</pre>
        )}
        {tests && tests.length > 0 && (
          <div className={styles.testResultsList}>
            {tests.map((t) => (
              <div key={t.name} className={styles.testResultItem}>
                <TestResultIcon status={t.status} />
                <span className={styles.testResultName}>{t.name}</span>
              </div>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}
