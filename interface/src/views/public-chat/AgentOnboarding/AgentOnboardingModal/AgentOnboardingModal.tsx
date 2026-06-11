import { useEffect, useRef } from "react";
import { Button, Drawer } from "@cypher-asi/zui";
import { GlassModal } from "../../../../components/GlassModal";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAuth } from "../../../../stores/auth-store";
import {
  ONBOARDING_STEPS,
  useAgentOnboardingStore,
  type OnboardingStepId,
} from "../agent-onboarding-store";
import {
  AUTOMATION_PRESETS,
  EXPERTISE_SKILL_GROUPS,
  MESSAGING_PROVIDERS,
  ONBOARDING_AVATARS,
  ONBOARDING_INTEGRATIONS,
  PERSONALITY_PRESETS,
} from "../onboarding-data";
import { OnboardingStepper, type OnboardingStepDescriptor } from "../OnboardingStepper";
import { IdentityStep } from "../IdentityStep";
import { ExpertiseStep } from "../ExpertiseStep";
import { IntegrationsStep } from "../IntegrationsStep";
import { ConnectionsStep } from "../ConnectionsStep";
import { AutomationsStep } from "../AutomationsStep";
import { LaunchStep, LAUNCH_FORM_ID } from "../LaunchStep";
import styles from "./AgentOnboardingModal.module.css";

const STEP_LABELS: Record<OnboardingStepId, string> = {
  identity: "Identity",
  expertise: "Skills",
  integrations: "Integrations",
  connections: "Messaging",
  automations: "Automations",
  launch: "Launch",
};

const STEP_DESCRIPTORS: readonly OnboardingStepDescriptor[] = ONBOARDING_STEPS.map((id) => ({
  id,
  label: STEP_LABELS[id],
}));

const MODAL_TITLE = "Create your agent";

/**
 * Orchestrator for the agent onboarding wizard. Owns store + auth wiring and
 * the Modal (desktop) / Drawer (mobile) shell; renders the active presentational
 * step with the relevant draft slice and change callbacks.
 */
export function AgentOnboardingModal(): React.ReactElement | null {
  const { isMobileLayout } = useAuraCapabilities();
  const { isAuthenticated } = useAuth();

  const isOpen = useAgentOnboardingStore((s) => s.isOpen);
  const currentStep = useAgentOnboardingStore((s) => s.currentStep);
  const draft = useAgentOnboardingStore((s) => s.draft);
  const close = useAgentOnboardingStore((s) => s.close);
  const next = useAgentOnboardingStore((s) => s.next);
  const back = useAgentOnboardingStore((s) => s.back);
  const goTo = useAgentOnboardingStore((s) => s.goTo);
  const markPendingApply = useAgentOnboardingStore((s) => s.markPendingApply);
  const launchSubmitting = useAgentOnboardingStore((s) => s.launchSubmitting);
  const setAvatar = useAgentOnboardingStore((s) => s.setAvatar);
  const setPersonality = useAgentOnboardingStore((s) => s.setPersonality);
  const toggleSkill = useAgentOnboardingStore((s) => s.toggleSkill);
  const toggleIntegration = useAgentOnboardingStore((s) => s.toggleIntegration);
  const toggleMessaging = useAgentOnboardingStore((s) => s.toggleMessaging);
  const toggleAutomation = useAgentOnboardingStore((s) => s.toggleAutomation);

  // Close the wizard the moment registration succeeds (auth flips false→true
  // while open). `useApplyAgentOnboarding` in the authenticated shell then
  // configures the CEO from the persisted draft.
  const wasAuthed = useRef(isAuthenticated);
  useEffect(() => {
    if (isOpen && !wasAuthed.current && isAuthenticated) {
      close();
    }
    wasAuthed.current = isAuthenticated;
  }, [isOpen, isAuthenticated, close]);

  if (!isOpen) return null;

  const stepId = ONBOARDING_STEPS[currentStep];
  const isLaunch = stepId === "launch";
  const isFirst = currentStep === 0;

  function renderStep(): React.ReactElement {
    switch (stepId) {
      case "identity":
        return (
          <IdentityStep
            avatars={ONBOARDING_AVATARS}
            selectedAvatar={draft.avatar}
            onSelectAvatar={setAvatar}
            personalities={PERSONALITY_PRESETS}
            selectedPersonality={draft.personality}
            onSelectPersonality={setPersonality}
          />
        );
      case "expertise":
        return (
          <ExpertiseStep
            groups={EXPERTISE_SKILL_GROUPS}
            selectedSkills={draft.skills}
            onToggleSkill={toggleSkill}
          />
        );
      case "integrations":
        return (
          <IntegrationsStep
            integrations={ONBOARDING_INTEGRATIONS}
            selected={draft.integrations}
            onToggle={toggleIntegration}
          />
        );
      case "connections":
        return (
          <ConnectionsStep
            providers={MESSAGING_PROVIDERS}
            selected={draft.messaging}
            onToggle={toggleMessaging}
          />
        );
      case "automations":
        return (
          <AutomationsStep
            automations={AUTOMATION_PRESETS}
            selected={draft.automations}
            onToggle={toggleAutomation}
          />
        );
      case "launch":
        return <LaunchStep />;
      default:
        return <IdentityStep
          avatars={ONBOARDING_AVATARS}
          selectedAvatar={draft.avatar}
          onSelectAvatar={setAvatar}
          personalities={PERSONALITY_PRESETS}
          selectedPersonality={draft.personality}
          onSelectPersonality={setPersonality}
        />;
    }
  }

  const inner = (
    <div className={styles.container}>
      <div className={styles.stepperRow}>
        <OnboardingStepper
          steps={STEP_DESCRIPTORS}
          currentStep={currentStep}
          compact={isMobileLayout}
          onStepSelect={goTo}
        />
      </div>
      <div className={styles.content}>{renderStep()}</div>
      <div className={styles.footer}>
        <Button
          type="button"
          variant="ghost"
          dimUnselected={false}
          className={styles.navBtn}
          onClick={back}
          disabled={isFirst}
        >
          Back
        </Button>
        {!isLaunch ? (
          <Button
            type="button"
            variant="primary"
            dimUnselected={false}
            className={styles.navBtnPrimary}
            onClick={next}
          >
            Next
          </Button>
        ) : isAuthenticated ? (
          <Button
            type="button"
            variant="primary"
            dimUnselected={false}
            className={styles.navBtnPrimary}
            onClick={() => {
              markPendingApply();
              close();
            }}
          >
            Create my agent
          </Button>
        ) : (
          <Button
            type="submit"
            form={LAUNCH_FORM_ID}
            variant="primary"
            dimUnselected={false}
            className={styles.navBtnPrimary}
            disabled={launchSubmitting}
          >
            {launchSubmitting ? "Creating..." : "Create account"}
          </Button>
        )}
      </div>
    </div>
  );

  if (isMobileLayout) {
    return (
      <Drawer
        side="bottom"
        isOpen={isOpen}
        onClose={close}
        title={MODAL_TITLE}
        className={styles.sheet}
        showMinimizedBar={false}
        defaultSize={560}
        maxSize={760}
      >
        {inner}
      </Drawer>
    );
  }

  return (
    <GlassModal
      isOpen={isOpen}
      onClose={close}
      title={MODAL_TITLE}
      size="lg"
      centerTitle
      titleClassName={styles.modalTitle}
      modalClassName={styles.modal}
    >
      {inner}
    </GlassModal>
  );
}
