import {
  Panel,
  Button,
  Heading,
  Text,
  Spinner,
  Topbar,
  Badge,
} from "@cypher-asi/zui";
import { lazy, Suspense } from "react";
import { HOST_BADGE_VARIANT, useLoginForm } from "./use-login-form";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { windowCommand } from "../../lib/windowCommand";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoginView.module.css";

const HostSettingsModal = lazy(() =>
  import("../../components/HostSettingsModal").then((module) => ({
    default: module.HostSettingsModal,
  })),
);

export function LoginView() {
  // Route-level guarding in `App.tsx` guarantees this component only mounts
  // when the explicit `initiallyLoggedIn` check is false and `useAuthStore`
  // reports no user, so no in-component auth short-circuit is needed here.
  // Post-login navigation is handled by the redirect effect in `useLoginForm`.
  const f = useLoginForm();

  return (
    <div className={`${styles.page} ${f.isMobileLayout ? styles.pageMobile : ""}`}>
      {!f.isMobileLayout && (
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} /></span>}
          actions={<WindowControls />}
        />
      )}
      <div className={`${styles.container} ${f.isMobileLayout ? styles.containerMobile : ""}`}>
        {f.isMobileLayout && (
          <div className={styles.mobileHero}>
            <Heading level={2}><span className={styles.brand}>AURA</span></Heading>
            <Text variant="muted" size="sm" align="center" className={styles.subtitle}>
              Connect to an Aura host, then sign in and get to work.
            </Text>
          </div>
        )}
        <Panel variant="solid" border="solid" borderRadius="lg" className={`${styles.card} ${f.isMobileLayout ? styles.cardMobile : ""}`}>
          {!f.isMobileLayout && (
            <div className={styles.header}>
              <Heading level={2}><span className={styles.brand}>AURA</span></Heading>
              <Text variant="muted" size="sm" align="center" className={styles.subtitle}>
                Zero Identity Authentication
              </Text>
            </div>
          )}

          {f.isMobileLayout && (
            <div className={styles.mobileSectionHeader}>
              <div className={styles.mobileSectionHeaderRow}>
                <Heading level={4}>Sign in</Heading>
                {f.showCompactHostStatus && (
                  <Button variant="ghost" size="sm" className={styles.mobileHostButton} onClick={f.openHostSettings}>
                    <span className={styles.mobileHostButtonLabel}>Host</span>
                    <span className={`${styles.mobileHostStatusDot} ${f.status === "online" || f.status === "auth_required" ? styles.mobileHostStatusDotOnline : styles.mobileHostStatusDotOffline}`} />
                    <span>{f.status.replace(/_/g, " ")}</span>
                  </Button>
                )}
              </div>
              {!f.showCompactHostStatus && (
                <Text variant="muted" size="sm" className={styles.mobileSectionEyebrow}>Host</Text>
              )}
            </div>
          )}

          {f.features.hostRetargeting && !f.showCompactHostStatus && (
            <div className={`${styles.hostCard} ${f.showHostWarning ? styles.hostCardWarning : ""} ${f.isMobileLayout ? styles.hostCardMobile : ""}`}>
              <div className={styles.hostCardTop}>
                <div className={styles.hostCardText}>
                  <Text size="sm" weight="medium">{f.hostStatus.title}</Text>
                  <Text variant="muted" size="sm" className={styles.hostLabel}>{f.hostLabel}</Text>
                </div>
                <Badge variant={HOST_BADGE_VARIANT[f.status]}>{f.status.replace(/_/g, " ")}</Badge>
              </div>
              <Text variant="muted" size="sm">{f.hostStatus.detail}</Text>
              <div className={`${styles.hostActions} ${f.isMobileLayout ? styles.hostActionsMobile : ""}`}>
                <Button variant="ghost" size="sm" onClick={f.openHostSettings}>Change host</Button>
                <Button variant="ghost" size="sm" onClick={f.handleRefreshHost} disabled={f.hostRefreshing} icon={f.hostRefreshing ? <Spinner size="sm" /> : undefined}>
                  {f.hostRefreshing ? "Checking..." : "Retry check"}
                </Button>
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

      {f.features.hostRetargeting && f.hostSettingsOpen ? (
        <Suspense fallback={null}>
          <HostSettingsModal isOpen={f.hostSettingsOpen} onClose={f.closeHostSettings} />
        </Suspense>
      ) : null}
    </div>
  );
}
