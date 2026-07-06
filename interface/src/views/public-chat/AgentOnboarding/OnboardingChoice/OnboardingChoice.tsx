import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Wand2 } from "lucide-react";
import { GlassModal } from "../../../../components/GlassModal";
import { useAuraCapabilities } from "../../../../hooks/use-aura-capabilities";
import { useAuth } from "../../../../stores/auth-store";
import { useAgentStore } from "../../../../apps/agents/stores/agent-store";
import { markFolderPromptPending } from "../../../../features/onboarding/folder-prompt-storage";
import { track } from "../../../../lib/analytics";
import { useAgentOnboardingStore } from "../agent-onboarding-store";
import styles from "./OnboardingChoice.module.css";

/**
 * Per-user "the two-lane choice was answered" flag. localStorage rather than
 * the onboarding store so the screen can never reappear on later devices'
 * reloads once a lane (or dismiss) was chosen on this one.
 */
const CHOICE_STORAGE_PREFIX = "aura:onboarding-choice";

function choiceKey(userId: string): string {
  return `${CHOICE_STORAGE_PREFIX}:${userId}`;
}

function readChoice(userId: string): string | null {
  try {
    return localStorage.getItem(choiceKey(userId));
  } catch {
    return null;
  }
}

function writeChoice(userId: string, lane: string): void {
  try {
    localStorage.setItem(choiceKey(userId), lane);
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

/**
 * First-run two-lane onboarding screen, replacing the old auto-run into the
 * full wizard. Shown once when a freshly signed-in user's account has no
 * agents (`firstRunDetected`, recorded before `ensureCeoHome` creates the
 * default CEO):
 *
 *  - "Just Start" leans on the auto-created CEO — no skills, personality, or
 *    integrations — and drops the user straight into `/chat`. On desktop it
 *    also arms the one-shot `ProjectFolderPrompt` banner offering to open a
 *    project folder.
 *  - "Set Up My Agent" opens the (now 3-step) `AgentOnboardingModal` wizard.
 *
 * Visitors who built their agent in the public wizard *before* signing up
 * already made this choice, so a pending wizard draft (`pendingApply`)
 * settles the flag instead of showing the screen.
 */
export function OnboardingChoice(): React.ReactElement | null {
  const navigate = useNavigate();
  const { hasDesktopBridge } = useAuraCapabilities();
  const { user, isAuthenticated } = useAuth();
  const userId = user?.user_id ?? null;

  const firstRunDetected = useAgentStore((s) => s.firstRunDetected);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const wizardOpen = useAgentOnboardingStore((s) => s.isOpen);
  const pendingApply = useAgentOnboardingStore((s) => s.pendingApply);
  const openWizard = useAgentOnboardingStore((s) => s.open);

  // localStorage isn't reactive; re-read the per-user flag whenever the
  // inputs settle and bump this counter after writing it.
  const [choiceVersion, setChoiceVersion] = useState(0);

  // First-run detection lives in `fetchAgents`. Most authenticated surfaces
  // trigger it anyway; this kick covers routes that don't. TTL + in-flight
  // dedupe in the store make it free when another caller got there first.
  useEffect(() => {
    if (isAuthenticated) void fetchAgents();
  }, [isAuthenticated, fetchAgents]);

  // A pending public-wizard draft counts as having chosen the "set up" lane
  // pre-signup — settle the flag so the choice never flashes after
  // `useApplyAgentOnboarding` consumes the draft.
  useEffect(() => {
    if (userId && pendingApply && !readChoice(userId)) {
      writeChoice(userId, "wizard_presignup");
      setChoiceVersion((v) => v + 1);
    }
  }, [userId, pendingApply]);

  void choiceVersion; // re-render trigger for the readChoice below

  if (!isAuthenticated || !userId || !firstRunDetected) return null;
  if (wizardOpen || pendingApply) return null;
  if (readChoice(userId) !== null) return null;

  function settle(lane: string): void {
    if (userId) writeChoice(userId, lane);
    setChoiceVersion((v) => v + 1);
  }

  function handleJustStart(): void {
    track("onboarding_lane_selected", { lane: "just_start" });
    settle("just_start");
    if (hasDesktopBridge) {
      markFolderPromptPending();
    }
    navigate("/chat");
  }

  function handleSetUp(): void {
    track("onboarding_lane_selected", { lane: "set_up" });
    settle("set_up");
    openWizard("onboarding_choice");
  }

  function handleDismiss(): void {
    track("onboarding_lane_selected", { lane: "dismissed" });
    settle("dismissed");
  }

  return (
    <GlassModal
      isOpen
      onClose={handleDismiss}
      title="Welcome to Aura"
      size="lg"
      centerTitle
      titleClassName={styles.modalTitle}
      modalClassName={styles.modal}
      className={styles.surface}
    >
      <div className={styles.container}>
        <p className={styles.lead}>How would you like to begin?</p>
        <div className={styles.lanes}>
          <button type="button" className={styles.lane} onClick={handleJustStart}>
            <span className={styles.laneIcon} aria-hidden="true">
              <MessageSquare size={22} />
            </span>
            <span className={styles.laneTitle}>Just Start</span>
            <span className={styles.laneSubtitle}>
              {hasDesktopBridge
                ? "Open a project or start chatting. We'll set up everything for you."
                : "Start chatting right away."}
            </span>
          </button>
          <button type="button" className={styles.lane} onClick={handleSetUp}>
            <span className={styles.laneIcon} aria-hidden="true">
              <Wand2 size={22} />
            </span>
            <span className={styles.laneTitle}>Set Up My Agent</span>
            <span className={styles.laneSubtitle}>
              Choose your agent&apos;s look, skills, and personality first. Takes
              about 2 minutes.
            </span>
          </button>
        </div>
        <p className={styles.footnote}>
          You can customize your agent anytime in settings.
        </p>
      </div>
    </GlassModal>
  );
}
