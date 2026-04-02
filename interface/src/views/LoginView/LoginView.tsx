import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Panel, Input, Button, Tabs, Heading, Text, Spinner, Topbar, Badge } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import { authApi } from "../../api/auth";
import { useHostStore, type HostConnectionStatus } from "../../stores/host-store";
import { getHostDisplayLabel, getTargetHostOrigin, requiresExplicitHostOrigin } from "../../lib/host-config";
import { ApiClientError } from "../../api/client";
import { HostSettingsModal } from "../../components/HostSettingsModal";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { windowCommand } from "../../lib/windowCommand";
import { WindowControls } from "../../components/WindowControls";
import styles from "./LoginView.module.css";

type AuthTab = "signin" | "register";

const AUTH_TABS = [
  { id: "signin", label: "Sign In" },
  { id: "register", label: "Create Account" },
];

const HOST_BADGE_VARIANT: Record<HostConnectionStatus, "running" | "pending" | "error"> = {
  checking: "pending",
  online: "running",
  auth_required: "running",
  unreachable: "error",
  error: "error",
};

const HOST_STATUS_COPY: Record<HostConnectionStatus, { title: string; detail: string }> = {
  checking: {
    title: "Checking Aura host",
    detail: "We’re verifying the configured host before sign-in.",
  },
  online: {
    title: "Host reachable",
    detail: "You can sign in against this Aura host now.",
  },
  auth_required: {
    title: "Sign in required",
    detail: "The host is reachable and ready for authentication.",
  },
  unreachable: {
    title: "Host unreachable",
    detail: "We couldn’t reach the configured Aura host. Update the host target or retry the connection check.",
  },
  error: {
    title: "Host check failed",
    detail: "Aura returned an unexpected error while checking the host connection.",
  },
};

function formatAuthError(err: unknown, hostLabel: string): string {
  if (err instanceof ApiClientError) {
    if (err.status === 401) {
      return "Email or password incorrect.";
    }
    if ([502, 503, 504].includes(err.status)) {
      return `Can’t reach Aura host at ${hostLabel}. Check the host target and try again.`;
    }
    return err.body.error;
  }

  if (err instanceof Error) {
    if (/fetch|network|load failed/i.test(err.message)) {
      return `Can’t reach Aura host at ${hostLabel}. Check the host target and try again.`;
    }
    return err.message;
  }

  return "An unexpected error occurred";
}

export function LoginView() {
  const { login, register } = useAuth();
  const status = useHostStore((s) => s.status);
  const refreshStatus = useHostStore((s) => s.refreshStatus);
  const hostLabel = getHostDisplayLabel();
  const { features, isMobileLayout, isNativeApp } = useAuraCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"input" | "sending" | "sent" | "error">("input");
  const [resetError, setResetError] = useState("");
  const { hostSettingsOpen, openHostSettings, closeHostSettings } = useUIModalStore(
    useShallow((s) => ({
      hostSettingsOpen: s.hostSettingsOpen,
      openHostSettings: s.openHostSettings,
      closeHostSettings: s.closeHostSettings,
    })),
  );
  const [hostRefreshing, setHostRefreshing] = useState(false);

  function resetForm(): void {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setName("");
    setInviteCode("");
    setError(null);
  }

  function openResetPassword(): void {
    setResetEmail(email);
    setResetStatus("input");
    setResetError("");
    setShowResetPassword(true);
  }

  function closeResetPassword(): void {
    setShowResetPassword(false);
  }

  async function handleResetSubmit(): Promise<void> {
    if (!resetEmail.trim()) return;
    setResetStatus("sending");
    try {
      await authApi.requestPasswordReset(resetEmail.trim());
      setResetStatus("sent");
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : "Failed to send reset email",
      );
      setResetStatus("error");
    }
  }

  function handleTabChange(id: string): void {
    setActiveTab(id as AuthTab);
    resetForm();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }

    if (isNativeApp && requiresExplicitHostOrigin() && !getTargetHostOrigin()) {
      setError("Set an Aura host before signing in.");
      openHostSettings();
      return;
    }

    if (activeTab === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (!name.trim()) {
        setError("Name is required");
        return;
      }
      if (!inviteCode.trim()) {
        setError("Invite code is required");
        return;
      }
    }

    setLoading(true);
    try {
      if (activeTab === "signin") {
        await login(email, password);
      } else {
        await register(email, password, name.trim(), inviteCode.trim());
      }
      await refreshStatus();
      navigate(from, { replace: true });
    } catch (err) {
      setError(formatAuthError(err, hostLabel));
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshHost(): Promise<void> {
    setHostRefreshing(true);
    try {
      await refreshStatus();
    } finally {
      setHostRefreshing(false);
    }
  }

  const missingNativeHost = isNativeApp && requiresExplicitHostOrigin() && !getTargetHostOrigin();
  const hostStatus = missingNativeHost
    ? {
        title: "Aura host required",
        detail: "Native mobile builds need a configured Aura host before sign-in.",
      }
    : HOST_STATUS_COPY[status];
  const showHostWarning = status === "unreachable" || status === "error";
  const showCompactHostStatus = isMobileLayout && (status === "online" || status === "auth_required");

  return (
    <div className={`${styles.page} ${isMobileLayout ? styles.pageMobile : ""}`}>
      {!isMobileLayout && (
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center"><img src="/AURA_logo_text_mark.png" alt="AURA" style={{ height: 11, display: "block" }} /></span>}
          actions={<WindowControls />}
        />
      )}
      <div className={`${styles.container} ${isMobileLayout ? styles.containerMobile : ""}`}>
        {isMobileLayout && (
          <div className={styles.mobileHero}>
            <Heading level={2}>
              <span className={styles.brand}>AURA</span>
            </Heading>
            <Text variant="muted" size="sm" align="center" className={styles.subtitle}>
              Connect to an Aura host, then sign in and get to work.
            </Text>
          </div>
        )}
        <Panel
          variant="solid"
          border="solid"
          borderRadius="lg"
          className={`${styles.card} ${isMobileLayout ? styles.cardMobile : ""}`}
        >
          {!isMobileLayout && (
            <div className={styles.header}>
              <Heading level={2}>
                <span className={styles.brand}>AURA</span>
              </Heading>
              <Text variant="muted" size="sm" align="center" className={styles.subtitle}>
                Zero Identity Authentication
              </Text>
            </div>
          )}

          {isMobileLayout && (
            <div className={styles.mobileSectionHeader}>
              <div className={styles.mobileSectionHeaderRow}>
                <Heading level={4}>Sign in</Heading>
                {showCompactHostStatus ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.mobileHostButton}
                    onClick={openHostSettings}
                  >
                    <span className={styles.mobileHostButtonLabel}>Host</span>
                    <span
                      className={`${styles.mobileHostStatusDot} ${
                        status === "online" || status === "auth_required"
                          ? styles.mobileHostStatusDotOnline
                          : styles.mobileHostStatusDotOffline
                      }`}
                    />
                    <span>{status.replace(/_/g, " ")}</span>
                  </Button>
                ) : null}
              </div>
              {!showCompactHostStatus ? (
                <Text variant="muted" size="sm" className={styles.mobileSectionEyebrow}>
                  Host
                </Text>
              ) : null}
            </div>
          )}

          {features.hostRetargeting && (
            !showCompactHostStatus ? (
              <div
                className={`${styles.hostCard} ${showHostWarning ? styles.hostCardWarning : ""} ${isMobileLayout ? styles.hostCardMobile : ""}`}
              >
                <div className={styles.hostCardTop}>
                  <div className={styles.hostCardText}>
                    <Text size="sm" weight="medium">
                      {hostStatus.title}
                    </Text>
                    <Text variant="muted" size="sm" className={styles.hostLabel}>
                      {hostLabel}
                    </Text>
                  </div>
                  <Badge variant={HOST_BADGE_VARIANT[status]}>
                    {status.replace(/_/g, " ")}
                  </Badge>
                </div>
                <Text variant="muted" size="sm">
                  {hostStatus.detail}
                </Text>
                <div className={`${styles.hostActions} ${isMobileLayout ? styles.hostActionsMobile : ""}`}>
                  <Button variant="ghost" size="sm" onClick={openHostSettings}>
                    Change host
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshHost}
                    disabled={hostRefreshing}
                    icon={hostRefreshing ? <Spinner size="sm" /> : undefined}
                  >
                    {hostRefreshing ? "Checking..." : "Retry check"}
                  </Button>
                </div>
              </div>
            ) : null
          )}

          {showResetPassword ? (
            <div className={styles.form}>
              <Text size="sm" weight="medium">Reset Password</Text>

              {resetStatus === "sent" ? (
                <>
                  <Text variant="muted" size="sm">
                    A password reset link has been sent to <strong>{resetEmail}</strong>
                  </Text>
                  <Button variant="primary" onClick={closeResetPassword}>
                    Back to Sign In
                  </Button>
                </>
              ) : (
                <>
                  <Text variant="muted" size="sm">
                    Enter your ZERO account email and we'll send a reset link.
                  </Text>
                  <Input
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="Email address"
                    type="email"
                    autoComplete="email"
                    disabled={resetStatus === "sending"}
                  />
                  {resetStatus === "error" && (
                    <div className={styles.error}>{resetError}</div>
                  )}
                  <div className={styles.resetActions}>
                    <Button
                      variant="ghost"
                      onClick={closeResetPassword}
                      disabled={resetStatus === "sending"}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleResetSubmit}
                      disabled={!resetEmail.trim() || resetStatus === "sending"}
                      icon={resetStatus === "sending" ? <Spinner size="sm" className={styles.spinnerWhite} /> : undefined}
                    >
                      {resetStatus === "sending" ? "Sending..." : "Send Reset Link"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <>
              <div className={styles.tabs}>
                <Tabs tabs={AUTH_TABS} value={activeTab} onChange={handleTabChange} />
              </div>

              <form onSubmit={handleSubmit} className={styles.form}>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  type="email"
                  autoComplete="email"
                  disabled={loading}
                />

                <Input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  type="password"
                  autoComplete={activeTab === "signin" ? "current-password" : "new-password"}
                  disabled={loading}
                />

                {activeTab === "signin" && (
                  <button
                    type="button"
                    className={styles.forgotPassword}
                    onClick={openResetPassword}
                  >
                    Forgot password?
                  </button>
                )}

                {activeTab === "register" && (
                  <>
                    <Input
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm password"
                      type="password"
                      autoComplete="new-password"
                      disabled={loading}
                    />
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Display name"
                      type="text"
                      autoComplete="name"
                      disabled={loading}
                    />
                    <Input
                      value={inviteCode}
                      onChange={(e) => setInviteCode(e.target.value)}
                      placeholder="Invite code"
                      type="text"
                      autoComplete="off"
                      disabled={loading}
                    />
                  </>
                )}

                {error && <div className={styles.error}>{error}</div>}

                <Button
                  type="submit"
                  variant="primary"
                  className={styles.submit}
                  disabled={loading}
                  icon={loading ? <Spinner size="sm" className={styles.spinnerWhite} /> : undefined}
                >
                  {loading
                    ? "Please wait..."
                    : activeTab === "signin"
                      ? "Sign In"
                      : "Create Account"}
                </Button>
              </form>
            </>
          )}
        </Panel>
      </div>

      {features.hostRetargeting && (
        <HostSettingsModal isOpen={hostSettingsOpen} onClose={closeHostSettings} />
      )}
    </div>
  );
}
