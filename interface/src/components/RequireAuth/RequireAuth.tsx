import { useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import { authApi } from "../../api/auth";
import { ApiClientError } from "../../api/client";
import styles from "./RequireAuth.module.css";

export function RequireAuth() {
  const { user, isAuthenticated, isLoading, zeroProRefreshError, refreshSession, logout } = useAuth();
  const location = useLocation();
  const [isRefreshingStatus, setIsRefreshingStatus] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [accessCodeError, setAccessCodeError] = useState("");
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);

  async function handleRefreshStatus(): Promise<void> {
    setIsRefreshingStatus(true);
    try {
      await refreshSession();
    } finally {
      setIsRefreshingStatus(false);
    }
  }

  async function handleRedeemCode(): Promise<void> {
    if (!accessCode.trim()) return;
    setIsRedeemingCode(true);
    setAccessCodeError("");
    try {
      await authApi.redeemAccessCode(accessCode.trim());
      await refreshSession();
    } catch (err) {
      let msg = "Invalid access code";
      if (err instanceof ApiClientError) {
        // Parse nested error from aura-network proxy
        try {
          const nested = JSON.parse(err.body.error);
          msg = nested?.error?.message?.replace(/^Bad request: /, "") ?? msg;
        } catch {
          msg = err.body.error;
        }
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setAccessCodeError(msg);
    } finally {
      setIsRedeemingCode(false);
    }
  }

  if (isLoading || isRefreshingStatus) {
    return (
      <div className={styles.loadingScreen}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <Spinner size="lg" />
          {isRefreshingStatus ? (
            <p style={{ color: "var(--color-text-secondary)", marginTop: 16 }}>
              Checking your status...
            </p>
          ) : null}
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
              : "AURA is currently in early access. Enter an access code or upgrade to ZERO Pro to get started."}
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

          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === "Enter" && handleRedeemCode()}
                placeholder="Enter access code"
                disabled={isRedeemingCode}
                style={{
                  padding: "10px 16px",
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--color-text-primary)",
                  borderRadius: 8,
                  border: "1px solid var(--color-border-default, rgba(255,255,255,0.2))",
                  fontSize: 14,
                  fontFamily: "monospace",
                  letterSpacing: "0.1em",
                  textAlign: "center",
                  width: 200,
                }}
              />
              <button
                onClick={handleRedeemCode}
                disabled={!accessCode.trim() || isRedeemingCode}
                style={{
                  padding: "10px 24px",
                  background: "transparent",
                  color: "var(--color-text-primary)",
                  borderRadius: 8,
                  border: "1px solid var(--color-border-default, rgba(255,255,255,0.2))",
                  cursor: accessCode.trim() && !isRedeemingCode ? "pointer" : "not-allowed",
                  fontWeight: 600,
                  fontSize: 14,
                  opacity: !accessCode.trim() || isRedeemingCode ? 0.5 : 1,
                }}
              >
                {isRedeemingCode ? "Verifying..." : "Submit"}
              </button>
            </div>
            {accessCodeError && (
              <p style={{ color: "var(--color-danger, #f87171)", marginTop: 8, fontSize: 13 }}>
                {accessCodeError}
              </p>
            )}
          </div>

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

  return <Outlet />;
}
