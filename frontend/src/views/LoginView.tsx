import { useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Panel, Input, Button, Tabs, Heading, Text, Spinner, Topbar, Badge } from "@cypher-asi/zui";
import { useAuth } from "../context/AuthContext";
import { useHost, type HostConnectionStatus } from "../context/HostContext";
import { ApiClientError } from "../api/client";
import { HostSettingsModal } from "../components/HostSettingsModal";
import { useAuraCapabilities } from "../hooks/use-aura-capabilities";
import { windowCommand } from "../lib/windowCommand";
import { WindowControls } from "../components/WindowControls";
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
  const { hostLabel, status, refreshStatus } = useHost();
  const { features, isMobileLayout } = useAuraCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);
  const [hostRefreshing, setHostRefreshing] = useState(false);

  function resetForm(): void {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
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

    if (activeTab === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      if (activeTab === "signin") {
        await login(email, password);
      } else {
        await register(email, password);
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

  const hostStatus = HOST_STATUS_COPY[status];
  const showHostWarning = status === "unreachable" || status === "error";
  const showCompactHostStatus = isMobileLayout && (status === "online" || status === "auth_required");

  return (
    <div className={`${styles.page} ${isMobileLayout ? styles.pageMobile : ""}`}>
      {!isMobileLayout && (
        <Topbar
          className="titlebar-drag"
          onDoubleClick={() => windowCommand("maximize")}
          icon={<img src="/aura-icon.png" alt="" className="titlebar-icon" />}
          title={<span className="titlebar-center">AURA</span>}
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
                    onClick={() => setHostSettingsOpen(true)}
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
                  <Button variant="ghost" size="sm" onClick={() => setHostSettingsOpen(true)}>
                    Change host
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefreshHost}
                    disabled={hostRefreshing}
                    icon={hostRefreshing ? <Spinner size="sm" /> : undefined}
                  >
                    {hostRefreshing ? "Retrying..." : "Retry check"}
                  </Button>
                </div>
              </div>
            ) : null
          )}

          <div className={styles.tabs}>
            <Tabs tabs={AUTH_TABS} value={activeTab} onChange={handleTabChange} />
          </div>

          <form onSubmit={handleSubmit} className={styles.form}>
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />

            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={activeTab === "signin" ? "current-password" : "new-password"}
              disabled={loading}
            />

            {activeTab === "register" && (
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
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
        </Panel>
      </div>
      {features.hostRetargeting && (
        <HostSettingsModal isOpen={hostSettingsOpen} onClose={() => setHostSettingsOpen(false)} />
      )}
    </div>
  );
}
