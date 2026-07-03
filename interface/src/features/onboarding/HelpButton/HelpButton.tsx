import { useCallback } from "react";
import { HelpCircle } from "lucide-react";
import { TaskbarIconButton, TASKBAR_ICON_SIZE } from "../../../components/AppNavRail";
import { useOnboardingStore, selectIsFullyComplete, selectIsChecklistVisible } from "../onboarding-store";
import { getDefaultOnboardingIntent, type OnboardingRuntime } from "../onboarding-constants";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { track } from "../../../lib/analytics";

export function HelpButton() {
  const reopenChecklist = useOnboardingStore((s) => s.reopenChecklist);
  const dismissChecklist = useOnboardingStore((s) => s.dismissChecklist);
  const resetOnboarding = useOnboardingStore((s) => s.resetOnboarding);
  const completeWelcomeIfNeeded = useOnboardingStore((s) => s.completeWelcomeIfNeeded);
  const selectedIntent = useOnboardingStore((s) => s.selectedIntent);
  const checklistDismissed = useOnboardingStore((s) => s.checklistDismissed);
  const isComplete = useOnboardingStore(selectIsFullyComplete);
  const isChecklistVisible = useOnboardingStore(selectIsChecklistVisible);
  const { supportsDesktopWorkspace } = useAuraCapabilities();
  const runtime: OnboardingRuntime = supportsDesktopWorkspace ? "desktop" : "web";

  const handleClick = useCallback(() => {
    if (isComplete) {
      resetOnboarding();
      completeWelcomeIfNeeded(selectedIntent ?? getDefaultOnboardingIntent(runtime), {
        checklistDismissed: false,
      });
      track("onboarding_reopened");
    } else if (checklistDismissed) {
      reopenChecklist();
      track("onboarding_reopened");
    } else {
      dismissChecklist();
    }
  }, [
    checklistDismissed,
    completeWelcomeIfNeeded,
    dismissChecklist,
    isComplete,
    reopenChecklist,
    resetOnboarding,
    runtime,
    selectedIntent,
  ]);

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
