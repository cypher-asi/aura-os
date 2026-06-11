import { Check } from "lucide-react";
import styles from "./OnboardingStepper.module.css";

export interface OnboardingStepDescriptor {
  readonly id: string;
  readonly label: string;
}

interface OnboardingStepperProps {
  readonly steps: readonly OnboardingStepDescriptor[];
  readonly currentStep: number;
  /** Compact single-line variant for narrow viewports. */
  readonly compact: boolean;
  readonly onStepSelect: (index: number) => void;
}

/**
 * Presentational top-row stepper for the onboarding wizard. Desktop renders a
 * labelled pill per stage; the compact (mobile) variant collapses to a
 * "Step N of M" caption plus a progress bar.
 */
export function OnboardingStepper({
  steps,
  currentStep,
  compact,
  onStepSelect,
}: OnboardingStepperProps): React.ReactElement {
  const total = steps.length;
  const current = steps[currentStep];

  if (compact) {
    const percent = total > 1 ? Math.round((currentStep / (total - 1)) * 100) : 100;
    return (
      <div className={styles.compact} aria-label={`Step ${currentStep + 1} of ${total}`}>
        <div className={styles.compactHeader}>
          <span className={styles.compactCount}>
            Step {currentStep + 1} of {total}
          </span>
          <span className={styles.compactLabel}>{current?.label}</span>
        </div>
        <div className={styles.progressTrack} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <ol className={styles.stepper}>
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;
        const state = isActive ? "active" : isDone ? "done" : "todo";
        return (
          <li key={step.id} className={styles.stepItem}>
            <button
              type="button"
              className={styles.step}
              data-state={state}
              aria-current={isActive ? "step" : undefined}
              onClick={() => onStepSelect(index)}
            >
              <span className={styles.badge} data-state={state}>
                {isDone ? <Check size={14} strokeWidth={3} /> : index + 1}
              </span>
              <span className={styles.label}>{step.label}</span>
            </button>
            {index < total - 1 ? <span className={styles.connector} data-done={isDone} aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
