import { useEffect, type FormEvent } from "react";
import { Button } from "@cypher-asi/zui";
import { Rocket } from "lucide-react";
import { useLoginForm } from "../../../LoginView/use-login-form";
import { LoginForm } from "../../../LoginView/LoginForm";
import { ResetPasswordForm } from "../../../LoginView/ResetPasswordForm";
import { useAuth } from "../../../../stores/auth-store";
import { useAgentOnboardingStore } from "../agent-onboarding-store";
import styles from "./LaunchStep.module.css";

/**
 * Final stage: account creation. Reuses the shared `LoginForm` (register tab),
 * exactly like `LoginOverlay`. When the visitor submits, we flag the draft for
 * application so `useApplyAgentOnboarding` configures the CEO once
 * authentication resolves. If the visitor is already signed in, we offer a
 * direct "Create my agent" action instead.
 */
export function LaunchStep(): React.ReactElement {
  const { isAuthenticated } = useAuth();
  const markPendingApply = useAgentOnboardingStore((s) => s.markPendingApply);
  const close = useAgentOnboardingStore((s) => s.close);
  const f = useLoginForm();
  const setTab = f.handleTabChange;

  // Force the Create Account tab on entry (the wizard is a signup flow).
  useEffect(() => {
    setTab("register");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event: FormEvent): void => {
    markPendingApply();
    f.handleSubmit(event);
  };

  const handleLaunchNow = (): void => {
    markPendingApply();
    close();
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
          <Button variant="primary" onClick={handleLaunchNow}>
            Create my agent
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.step}>
      <p className={styles.intro}>Create your account to bring your agent to life.</p>
      <div className={styles.formWrap}>
        {f.showResetPassword ? (
          <ResetPasswordForm
            resetEmail={f.resetEmail}
            setResetEmail={f.setResetEmail}
            resetStatus={f.resetStatus}
            resetError={f.resetError}
            onSubmit={f.handleResetSubmit}
            onClose={f.closeResetPassword}
          />
        ) : (
          <LoginForm
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
        )}
      </div>
    </div>
  );
}
