import type { ReactNode, ForwardedRef } from 'react';
import { forwardRef } from 'react';
import clsx from 'clsx';
import { Panel } from '../Panel';
import type { PanelProps } from '../Panel';
import { Button } from '../../Button';
import styles from './PanelWizard.module.css';

export interface WizardStep {
  /** Unique identifier for the step */
  id: string;
  /** Label shown in the step indicator */
  label: string;
  /** Content to render when this step is active */
  content: ReactNode;
  /** Whether all required fields are filled - controls Next button */
  isComplete?: boolean;
}

export interface PanelWizardProps extends Omit<PanelProps, 'children'> {
  /** Array of wizard steps */
  steps: WizardStep[];
  /** Current active step index (0-based) */
  currentStep: number;
  /** Callback when step changes */
  onStepChange: (step: number) => void;
  /** Label for the previous button (default: "Previous") */
  prevLabel?: string;
  /** Label for the next button (default: "Next") */
  nextLabel?: string;
  /** Label for the finish button on last step (default: "Finish") */
  finishLabel?: string;
  /** Called when user clicks Next/Finish on last step */
  onFinish?: () => void;
  /** Whether to show the step indicators (default: true) */
  showSteps?: boolean;
  /** Whether to show the footer navigation (default: true) */
  showFooter?: boolean;
}

/**
 * PanelWizard - A panel with step-based wizard navigation
 *
 * Provides a multi-step wizard within a panel. Parent manages the current step,
 * and this component renders step indicators, content, and navigation buttons.
 *
 * @example
 * ```tsx
 * const [currentStep, setCurrentStep] = useState(0);
 * const [formData, setFormData] = useState({ name: '', email: '' });
 *
 * const steps: WizardStep[] = [
 *   {
 *     id: 'info',
 *     label: 'Personal Info',
 *     content: <PersonalInfoForm data={formData} onChange={setFormData} />,
 *     isComplete: formData.name.length > 0,
 *   },
 *   {
 *     id: 'confirm',
 *     label: 'Confirmation',
 *     content: <ConfirmationStep data={formData} />,
 *     isComplete: true,
 *   },
 * ];
 *
 * <PanelWizard
 *   steps={steps}
 *   currentStep={currentStep}
 *   onStepChange={setCurrentStep}
 *   onFinish={() => console.log('Done!', formData)}
 *   variant="glass"
 *   borderRadius="md"
 * />
 * ```
 */
export const PanelWizard = forwardRef(function PanelWizard(
  {
    steps,
    currentStep,
    onStepChange,
    prevLabel = 'Previous',
    nextLabel = 'Next',
    finishLabel = 'Finish',
    onFinish,
    showSteps = true,
    showFooter = true,
    border,
    className,
    ...panelProps
  }: PanelWizardProps,
  ref: ForwardedRef<HTMLDivElement>
) {
  const borderNone = border === 'none';
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;
  const currentStepData = steps[currentStep];
  const canProceed = currentStepData?.isComplete !== false;

  const handlePrevious = () => {
    if (!isFirstStep) {
      onStepChange(currentStep - 1);
    }
  };

  const handleNext = () => {
    if (isLastStep) {
      onFinish?.();
    } else {
      onStepChange(currentStep + 1);
    }
  };

  const handleStepClick = (index: number) => {
    // Allow clicking on previous steps (to go back)
    if (index < currentStep) {
      onStepChange(index);
      return;
    }
    
    // Allow clicking on next step if current step is complete
    if (index === currentStep + 1 && canProceed) {
      onStepChange(index);
      return;
    }
    
    // Allow clicking on any future step if all steps up to it are complete
    if (index > currentStep) {
      // Check if all steps from current to index-1 are complete
      const canSkipTo = steps.slice(currentStep, index).every(step => step.isComplete !== false);
      if (canSkipTo) {
        onStepChange(index);
      }
    }
  };

  if (steps.length === 0) {
    return (
      <Panel ref={ref} border={border} className={clsx(styles.panelWizard, borderNone && styles.borderNone, className)} {...panelProps}>
        <div className={styles.empty}>No steps defined</div>
      </Panel>
    );
  }

  return (
    <Panel ref={ref} border={border} className={clsx(styles.panelWizard, borderNone && styles.borderNone, className)} {...panelProps}>
      {showSteps && (
        <div className={styles.header}>
          <div className={styles.steps}>
            {steps.map((step, index) => {
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              const isFuture = index > currentStep;
              
              // Check if this future step is reachable (all previous steps complete)
              const isReachable = isFuture && steps.slice(currentStep, index).every(s => s.isComplete !== false);
              const isDisabled = isFuture && !isReachable;

              return (
                <div key={step.id} className={styles.stepWrapper}>
                  {index > 0 && (
                    <div
                      className={clsx(
                        styles.connector,
                        isCompleted && styles.connectorCompleted
                      )}
                    />
                  )}
                  <button
                    type="button"
                    className={clsx(
                      styles.step,
                      isCompleted && styles.completed,
                      isCurrent && styles.current,
                      isFuture && !isReachable && styles.future,
                      isFuture && isReachable && styles.reachable
                    )}
                    onClick={() => handleStepClick(index)}
                    disabled={isDisabled}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    <span className={styles.stepNumber}>{index + 1}</span>
                    <span className={styles.stepLabel}>{step.label}</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className={styles.content}>
        {currentStepData?.content}
      </div>

      {showFooter && (
        <div className={styles.footer}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePrevious}
            disabled={isFirstStep}
          >
            {prevLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleNext}
            disabled={!canProceed}
          >
            {isLastStep ? finishLabel : nextLabel}
          </Button>
        </div>
      )}
    </Panel>
  );
});

PanelWizard.displayName = 'PanelWizard';
