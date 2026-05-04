import { useCallback } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import {
  useOnboardingStore,
  selectIsChecklistVisible,
  selectCompletedCount,
  selectTotalTasks,
  selectProgressPercent,
} from "../onboarding-store";
import { ONBOARDING_TASKS } from "../onboarding-constants";
import { ChecklistTaskRow } from "./ChecklistTaskRow";
import { useProjectsList } from "../../../apps/projects/useProjectsList";
import { useUIModalStore } from "../../../stores/ui-modal-store";
import { useAgentStore } from "../../../apps/agents/stores/agent-store";
import { track } from "../../../lib/analytics";
import styles from "./OnboardingChecklist.module.css";

export function OnboardingChecklist() {
  const isVisible = useOnboardingStore(selectIsChecklistVisible);
  const tasks = useOnboardingStore((s) => s.checklistTasks);
  const collapsed = useOnboardingStore((s) => s.checklistCollapsed);
  const toggleCollapsed = useOnboardingStore((s) => s.toggleChecklistCollapsed);
  const dismissChecklist = useOnboardingStore((s) => s.dismissChecklist);
  const completedCount = useOnboardingStore(selectCompletedCount);
  const totalTasks = selectTotalTasks();
  const progressPercent = useOnboardingStore(selectProgressPercent);
  const navigate = useNavigate();
  const { openNewProjectModal } = useProjectsList();
  const openOrgBilling = useUIModalStore((s) => s.openOrgBilling);
  const openCreateAgentModal = useAgentStore((s) => s.openCreateAgentModal);

  const handleTaskClick = useCallback(
    (taskId: string, route: string | null) => {
      track("onboarding_task_clicked", { task_id: taskId });
      if (taskId === "create_project") {
        openNewProjectModal();
      } else if (taskId === "create_agent") {
        navigate("/agents");
        openCreateAgentModal();
      } else if (taskId === "view_billing") {
        openOrgBilling();
      } else if (route) {
        navigate(route);
      }
    },
    [navigate, openNewProjectModal, openCreateAgentModal, openOrgBilling],
  );

  const handleDismiss = useCallback(() => {
    dismissChecklist();
    track("onboarding_checklist_dismissed", { tasks_completed: completedCount });
  }, [dismissChecklist, completedCount]);

  if (!isVisible) return null;

  const widget = (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.headerInfo}>
          <span className={styles.headerTitle}>Getting Started</span>
          <span className={styles.headerProgress}>
            {completedCount} of {totalTasks} complete
          </span>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.iconButton} onClick={toggleCollapsed} aria-label={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button type="button" className={styles.iconButton} onClick={handleDismiss} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${progressPercent}%` }} />
      </div>

      {!collapsed && (
        <div className={styles.taskList}>
          {ONBOARDING_TASKS.map((task) => (
            <ChecklistTaskRow
              key={task.id}
              task={task}
              completed={!!tasks[task.id]}
              onClick={() => handleTaskClick(task.id, task.route)}
            />
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(widget, document.body);
}
