import {
  Panel,
  Button,
  Heading,
  Text,
  Spinner,
  Topbar,
  Badge,
} from "@cypher-asi/zui";
import { lazy, Suspense, useLayoutEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { HOST_BADGE_VARIANT, useLoginForm } from "./use-login-form";
import { LoginForm } from "./LoginForm";
import { ResetPasswordForm } from "./ResetPasswordForm";
import { signalDesktopReady } from "../../lib/desktop-ready";
import { windowCommand } from "../../lib/windowCommand";
import { WindowControls } from "../../components/WindowControls";
import { useAuthStore } from "../../stores/auth-store";
import styles from "./LoginView.module.css";

const HostSettingsModal = lazy(() =>
  import("../../components/HostSettingsModal").then((module) => ({
    default: module.HostSettingsModal,
  })),
);

export function LoginView() {
  const { isAuthenticated, isLoading } = useAuthStore(
    useShallow((s) => ({
      isAuthenticated: s.user !== null,
      isLoading: s.isLoading,
    })),
  );
  const f = useLoginForm();

  useLayoutEffect(() => {
    if (!isAuthenticated && !isLoading) {
      signalDesktopReady();
    }
  }, [isAuthenticated, isLoading]);

  // `App` holds the whole route tree back until the boot-time restore has
  // finished, so by the time `LoginView` mounts we already know whether the
  // user is authenticated. The `isAuthenticated || isLoading` short-circuit
  // is still useful post-login while the redirect effect in `useLoginForm`
  // commits and while a manual `refreshSession()` is in flight.
  if (isAuthenticated || isLoading) {
    return null;
  }

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
