import { useCallback, useEffect, useRef } from "react";
import { Modal } from "@cypher-asi/zui";
import { ListChecks } from "lucide-react";
import { useOnboardingStore, selectIsWelcomeVisible } from "../onboarding-store";
import { ONBOARDING_TASKS } from "../onboarding-constants";
import { track } from "../../../lib/analytics";
import styles from "./WelcomeModal.module.css";

const TOTAL_STEPS = 2;

function Step1() {
  return (
    <div className={styles.stepContent}>
      <img src="/aura-icon.png" alt="AURA" className={styles.logo} />
      <h2 className={styles.stepTitle}>Welcome to AURA</h2>
      <p className={styles.stepDescription}>
        Your AI-powered workspace for building, creating, and collaborating
        with intelligent agents. Chat, automate tasks, generate images, and
        more — all in one place.
      </p>
    </div>
  );
}

function Step2() {
  return (
    <div className={styles.stepContent}>
      <div className={styles.stepIcon}><ListChecks size={40} /></div>
      <h2 className={styles.stepTitle}>Get Started</h2>
      <p className={styles.stepDescription}>
        Complete these quick steps to get the most out of AURA. You can
        always revisit this from the help button in the taskbar.
      </p>
      <div className={styles.taskPreview}>
        {ONBOARDING_TASKS.map((task) => (
          <div key={task.id} className={styles.taskPreviewRow}>
            <task.icon size={16} />
            <div>
              <span className={styles.taskPreviewLabel}>{task.label}</span>
              <span className={styles.taskPreviewHint}>{task.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const STEPS = [Step1, Step2];

export function WelcomeModal() {
  const isVisible = useOnboardingStore(selectIsWelcomeVisible);
  const step = useOnboardingStore((s) => s.welcomeStep);
  const setStep = useOnboardingStore((s) => s.setWelcomeStep);
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
  const skipWelcome = useOnboardingStore((s) => s.skipWelcome);

  const trackedStarted = useRef(false);
  useEffect(() => {
    if (isVisible && !trackedStarted.current) {
      track("onboarding_started");
      trackedStarted.current = true;
    }
  }, [isVisible]);

  const handleNext = useCallback(() => {
    if (step < TOTAL_STEPS - 1) {
      setStep(step + 1);
    } else {
      completeWelcome();
      track("onboarding_welcome_completed");
    }
  }, [step, setStep, completeWelcome]);

  const handleSkip = useCallback(() => {
    skipWelcome();
    track("onboarding_welcome_skipped", { at_step: step });
  }, [skipWelcome, step]);

  if (!isVisible) return null;

  const StepComponent = STEPS[step];
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <Modal
      isOpen
      onClose={() => {}}
      title=""
      size="lg"
      noPadding
      className={styles.modal}
    >
      <div className={styles.container}>
        <StepComponent />
        <div className={styles.footer}>
          <button type="button" className={styles.skipLink} onClick={handleSkip}>
            Skip
          </button>
          <button type="button" className={styles.skipLink} onClick={handleNext}>
            {isLast ? "Start" : "Next"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
