import { useCallback, useEffect, useMemo, useRef } from "react";
import { Modal } from "@cypher-asi/zui";
import { ArrowRight, Code2, MessageSquare, MonitorDown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useOnboardingStore, selectIsWelcomeVisible } from "../onboarding-store";
import { type OnboardingIntent } from "../onboarding-constants";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { track } from "../../../lib/analytics";
import styles from "./WelcomeModal.module.css";

interface IntentOption {
  intent: OnboardingIntent;
  title: string;
  description: string;
  details: readonly string[];
  action: string;
  icon: typeof MessageSquare;
}

const INTENT_PATH: Record<OnboardingIntent, string> = {
  chat: "/chat",
  build: "/projects",
};

export function WelcomeModal() {
  const isVisible = useOnboardingStore(selectIsWelcomeVisible);
  const completeWelcome = useOnboardingStore((s) => s.completeWelcome);
  const skipWelcome = useOnboardingStore((s) => s.skipWelcome);
  const { supportsDesktopWorkspace } = useAuraCapabilities();
  const navigate = useNavigate();

  const recommendedIntent: OnboardingIntent = supportsDesktopWorkspace ? "build" : "chat";
  const intentOptions = useMemo<IntentOption[]>(() => {
    const chatOption: IntentOption = {
      intent: "chat",
      title: "Chat with Aura",
      description: "Start with a conversation, pick a model, and keep history without setting up a project.",
      details: ["Best for questions, planning, writing, and quick AI help", "No agent or workspace setup required"],
      action: "Start chatting",
      icon: MessageSquare,
    };
    const buildOption: IntentOption = {
      intent: "build",
      title: "Build with Aura",
      description: supportsDesktopWorkspace
        ? "Open a coding workspace where Aura can use local agents, files, terminal, and project context."
        : "Use remote agents where available. For local repositories and desktop agents, continue in Aura Desktop.",
      details: supportsDesktopWorkspace
        ? ["Best for code changes, tasks, diffs, and verification", "Uses desktop workspace capabilities"]
        : ["Starts with remote Build where supported", "Desktop unlocks local repos, terminal, and local agents"],
      action: supportsDesktopWorkspace ? "Open Build" : "Explore Build",
      icon: Code2,
    };
    return supportsDesktopWorkspace ? [buildOption, chatOption] : [chatOption, buildOption];
  }, [supportsDesktopWorkspace]);

  const trackedStarted = useRef(false);
  useEffect(() => {
    if (isVisible && !trackedStarted.current) {
      track("onboarding_started");
      trackedStarted.current = true;
    }
  }, [isVisible]);

  const handleChoose = useCallback(
    (intent: OnboardingIntent) => {
      completeWelcome(intent);
      track("onboarding_welcome_completed", {
        intent,
        recommended_intent: recommendedIntent,
        runtime: supportsDesktopWorkspace ? "desktop" : "web",
      });
      navigate(INTENT_PATH[intent]);
    },
    [completeWelcome, navigate, recommendedIntent, supportsDesktopWorkspace],
  );

  const handleSkip = useCallback(() => {
    skipWelcome();
    track("onboarding_welcome_skipped", {
      recommended_intent: recommendedIntent,
      runtime: supportsDesktopWorkspace ? "desktop" : "web",
    });
  }, [recommendedIntent, skipWelcome, supportsDesktopWorkspace]);

  const handleDownloadDesktop = useCallback(() => {
    completeWelcome("build");
    track("onboarding_desktop_download_clicked", {
      source: "welcome_modal",
      recommended_intent: recommendedIntent,
      runtime: supportsDesktopWorkspace ? "desktop" : "web",
    });
    navigate("/download");
  }, [completeWelcome, navigate, recommendedIntent, supportsDesktopWorkspace]);

  if (!isVisible) return null;

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
        <div className={styles.hero}>
          <img src="/aura-icon.png" alt="AURA" className={styles.logo} />
          <h2 className={styles.stepTitle}>
            {supportsDesktopWorkspace ? "Build with Aura, or start with chat" : "Start with Aura"}
          </h2>
          <p className={styles.stepDescription}>
            {supportsDesktopWorkspace
              ? "Aura can be a coding workspace or a simple AI conversation. Choose where you want to start."
              : "On web, Aura is fastest as a private chat surface. Build is available through remote agents where supported, and local work continues in Desktop."}
          </p>
        </div>

        <div className={styles.intentGrid}>
          {intentOptions.map((option, index) => {
            const Icon = option.icon;
            const isRecommended = option.intent === recommendedIntent;
            return (
              <button
                key={option.intent}
                type="button"
                className={`${styles.intentCard} ${index === 0 ? styles.intentCardPrimary : styles.intentCardSecondary} ${isRecommended ? styles.intentCardRecommended : ""}`}
                onClick={() => handleChoose(option.intent)}
              >
                <span className={styles.intentIcon}>
                  <Icon size={20} />
                </span>
                <span className={styles.intentBody}>
                  <span className={styles.intentHeader}>
                    <span className={styles.intentTitle}>{option.title}</span>
                    {isRecommended && <span className={styles.recommendedLabel}>Recommended</span>}
                  </span>
                  <span className={styles.intentDescription}>{option.description}</span>
                  <span className={styles.intentDetails}>
                    {option.details.map((detail) => (
                      <span key={detail}>{detail}</span>
                    ))}
                  </span>
                  <span className={styles.intentAction}>
                    {option.action}
                    <ArrowRight size={14} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        {!supportsDesktopWorkspace && (
          <div className={styles.desktopNote}>
            <MonitorDown size={16} />
            <span>Working against local repositories works best in Aura Desktop.</span>
            <button type="button" onClick={handleDownloadDesktop}>Get desktop</button>
          </div>
        )}

        <div className={styles.footer}>
          <button type="button" className={styles.skipLink} onClick={handleSkip}>
            Skip for now
          </button>
        </div>
      </div>
    </Modal>
  );
}
