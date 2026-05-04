import { useCallback } from "react";
import { HelpCircle } from "lucide-react";
import { TaskbarIconButton, TASKBAR_ICON_SIZE } from "../../../components/AppNavRail";
import { useOnboardingStore, selectIsFullyComplete, selectIsChecklistVisible } from "../onboarding-store";
import { track } from "../../../lib/analytics";

export function HelpButton() {
  const reopenChecklist = useOnboardingStore((s) => s.reopenChecklist);
  const dismissChecklist = useOnboardingStore((s) => s.dismissChecklist);
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);
  const checklistDismissed = useOnboardingStore((s) => s.checklistDismissed);
  const isComplete = useOnboardingStore(selectIsFullyComplete);
  const isChecklistVisible = useOnboardingStore(selectIsChecklistVisible);

  const handleClick = useCallback(() => {
    if (isComplete) {
      resetOnboarding();
      track("onboarding_reopened");
    } else if (checklistDismissed) {
      reopenChecklist();
      track("onboarding_reopened");
    } else {
      dismissChecklist();
    }
  }, [isComplete, checklistDismissed, reopenChecklist, dismissChecklist, resetOnboarding]);

  return (
    <TaskbarIconButton
      icon={<HelpCircle size={TASKBAR_ICON_SIZE} />}
      title="Help & Getting Started"
      aria-label="Help & Getting Started"
      selected={isChecklistVisible}
      onClick={handleClick}
    />
  );
}
