import {
  Panel,
  Heading,
  Text,
} from "@cypher-asi/zui";
import { useLoginForm } from "./use-login-form";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { ShellTitlebar } from "../../components/ShellTitlebar";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoginView.module.css";

export function LoginView() {
  // Route-level guarding in `App.tsx` guarantees this component only mounts
  // when the explicit `initiallyLoggedIn` check is false and `useAuthStore`
  // reports no user, so no in-component auth short-circuit is needed here.
  // Post-login navigation is handled by the redirect effect in `useLoginForm`.
  const f = useLoginForm();

  return (
    <div className={`${styles.page} ${f.isMobileLayout ? styles.pageMobile : ""}`}>
      {!f.isMobileLayout && (
        <div className={styles.videoBackground} aria-hidden="true">
          <video
            className={styles.loginVideo}
            src="/AURA_visual_loop.mp4"
            autoPlay
            loop
            muted
            playsInline
          />
        </div>
      )}
      {!f.isMobileLayout && (
        <ShellTitlebar
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={
            <span className="titlebar-center">
              <img
                src="/AURA_logo_text_mark.png"
                alt="AURA"
                data-aura-wordmark
                style={{ height: 11, display: "block" }}
              />
            </span>
          }
          actions={<WindowControls />}
        />
      )}
      <div className={`${styles.container} ${f.isMobileLayout ? styles.containerMobile : ""}`}>
        {f.isMobileLayout && (
          <div className={styles.mobileHero}>
            <Heading level={2}><span className={styles.brand}>AURA</span></Heading>
            <Text variant="muted" size="sm" align="center" className={styles.subtitle}>
              Sign in or create an account to get started.
            </Text>
          </div>
        )}
        <Panel variant="solid" border="solid" borderRadius="lg" className={`${styles.card} ${f.isMobileLayout ? styles.cardMobile : ""}`}>
          {!f.isMobileLayout && (
            <Text align="center" className={styles.cardTitle}>
              Login to AURA
            </Text>
          )}

          {f.isMobileLayout && (
            <div className={styles.mobileSectionHeader}>
              <div className={styles.mobileSectionHeaderRow}>
                <Heading level={4}>Sign in</Heading>
              </div>
            </div>
          )}

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
              onSubmit={f.handleSubmit}
              onForgotPassword={f.openResetPassword}
            />
          )}
        </Panel>
      </div>

    </div>
  );
}
