import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import styles from "./RequireAuth.module.css";

export function RequireAuth() {
  const { user, isAuthenticated, isLoading, zeroProRefreshError, refreshSession, logout } = useAuth();
  const location = useLocation();
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);

  async function handleRefreshStatus(): Promise<void> {
    setIsRefreshingStatus(true);
    try {
      await refreshSession();
    } finally {
      setIsRefreshingStatus(false);
    }
  }

  if (isRefreshingStatus) {
    return (
      <div className={styles.loadingScreen}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <Spinner size="lg" />
          <p style={{ color: "var(--color-text-secondary)", marginTop: 16 }}>
            Checking your status...
          </p>
        </div>
      </div>
    );
  }

  if (isLoading && !isAuthenticated) {
    return (
      <div className={styles.loadingScreen}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!user?.is_zero_pro && !user?.is_access_granted) {
    const isVerificationError = Boolean(zeroProRefreshError);
    return (
      <div className={styles.loadingScreen}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ marginBottom: 12 }}>
            {isVerificationError ? "Unable To Verify Access" : "Access Required"}
          </h2>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: 24 }}>
            {isVerificationError
              ? "AURA could not verify your access right now. Please try refreshing your status."
              : "AURA is currently in early access. Upgrade to ZERO Pro to get started."}
          </p>
          {!isVerificationError ? (
            <p style={{ color: "var(--color-text-secondary)", marginBottom: 24 }}>
              If you recently upgraded to ZERO Pro, refresh your status to check again.
            </p>
          ) : null}
          {zeroProRefreshError ? (
            <p style={{ color: "var(--color-danger, #f87171)", marginBottom: 24 }}>
              {zeroProRefreshError}
            </p>
          ) : null}

          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => void handleRefreshStatus()}
              style={{
                padding: "10px 24px",
                background: "transparent",
                color: "var(--color-text-primary)",
                borderRadius: 8,
                border: "1px solid var(--color-border-default, rgba(255,255,255,0.2))",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Refresh Status
            </button>
            <button
              onClick={() => logout()}
              style={{
                padding: "10px 24px",
                background: "transparent",
                color: "var(--color-text-secondary)",
                borderRadius: 8,
                border: "1px solid var(--color-border-default, rgba(255,255,255,0.2))",
                cursor: "pointer",
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              Log Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {isLoading ? (
        <div className={styles.sessionPendingBanner}>
          <Spinner size="sm" />
          <span>Updating session…</span>
        </div>
      ) : null}
      <Outlet />
    </>
  );
}
