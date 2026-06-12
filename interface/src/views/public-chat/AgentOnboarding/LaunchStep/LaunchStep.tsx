import { useEffect, type FormEvent } from "react";
import { Rocket } from "lucide-react";
import { useLoginForm } from "../../../LoginView/use-login-form";
import { LoginForm } from "../../../LoginView/LoginForm";
import { useAuth } from "../../../../stores/auth-store";
import { useAgentOnboardingStore } from "../agent-onboarding-store";
import styles from "./LaunchStep.module.css";

/** Id linking the modal footer "Create account" button to this step's form. */
export const LAUNCH_FORM_ID = "agent-onboarding-register";

/**
 * Final stage: account creation. Reuses the shared `LoginForm` locked to the
 * Create Account tab (the wizard is a signup-only flow, so the Sign In tab is
 * hidden). The primary CTA lives in the modal footer; this step renders only
 * the form fields and submits via the footer button's `form` association. On
 * submit we flag the draft for application so `useApplyAgentOnboarding`
 * configures the CEO once authentication resolves.
 */
export function LaunchStep(): React.ReactElement {
  const { isAuthenticated } = useAuth();
  const markPendingApply = useAgentOnboardingStore((s) => s.markPendingApply);
  const setLaunchSubmitting = useAgentOnboardingStore((s) => s.setLaunchSubmitting);
  const f = useLoginForm();
  const setTab = f.handleTabChange;

  // Force the Create Account tab on entry (the wizard is a signup flow).
  useEffect(() => {
    setTab("register");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirror the in-flight state up to the store so the footer CTA can show
  // progress and guard against double submits.
  useEffect(() => {
    setLaunchSubmitting(f.loading);
  }, [f.loading, setLaunchSubmitting]);

  const handleSubmit = (event: FormEvent): void => {
    markPendingApply();
    f.handleSubmit(event);
  };

  if (isAuthenticated) {
    return (
      <div className={styles.step}>
        <div className={styles.authed}>
          <Rocket size={28} aria-hidden="true" />
          <h3 className={styles.authedTitle}>You're all set</h3>
          <p className={styles.authedHint}>
            We'll apply your choices to your agent and take you to your chat.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <p className={styles.intro}>Create your account to bring your agent to life.</p>
      <div className={styles.formWrap}>
        <LoginForm
          formId={LAUNCH_FORM_ID}
          hideTabs
          hideSubmit
          activeTab={f.activeTab}
          email={f.email}
          setEmail={f.setEmail}
          recentEmails={f.recentEmails}
          addingNewEmail={f.addingNewEmail}
          onSelectEmail={f.handleSelectEmail}
          onAddAccount={f.handleAddAccount}
          onRemoveEmail={f.handleRemoveEmail}
          password={f.password}
          setPassword={f.setPassword}
          confirmPassword={f.confirmPassword}
          setConfirmPassword={f.setConfirmPassword}
          name={f.name}
          setName={f.setName}
          inviteCode={f.inviteCode}
          setInviteCode={f.setInviteCode}
          error={f.error}
          loading={f.loading}
          onTabChange={f.handleTabChange}
          onSubmit={handleSubmit}
          onForgotPassword={f.openResetPassword}
        />
      </div>
    </div>
  );
}
