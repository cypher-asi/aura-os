import { Check, ChevronRight } from "lucide-react";
import type { OnboardingTaskDef } from "../onboarding-constants";
import styles from "./OnboardingChecklist.module.css";

interface Props {
  task: OnboardingTaskDef;
  completed: boolean;
  onClick: () => void;
}

export function ChecklistTaskRow({ task, completed, onClick }: Props) {
  return (
    <button
      type="button"
      className={`${styles.taskRow} ${completed ? styles.taskRowCompleted : ""}`}
      onClick={completed ? undefined : onClick}
      disabled={completed}
    >
      <span className={`${styles.taskCheck} ${completed ? styles.taskCheckDone : ""}`}>
        {completed ? <Check size={12} /> : null}
      </span>
      <div className={styles.taskInfo}>
        <span className={styles.taskLabel}>{task.label}</span>
        <span className={styles.taskDescription}>{task.description}</span>
      </div>
      {!completed && <ChevronRight size={14} className={styles.taskArrow} />}
    </button>
  );
}
