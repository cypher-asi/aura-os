import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import styles from "./RequireAuth.module.css";

export function RequireAuth() {
  const { user, isAuthenticated, isLoading, logout } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className={styles.loadingScreen}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!user?.is_zero_pro) {
    return (
      <div className={styles.loadingScreen}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <h2 style={{ marginBottom: 12 }}>ZERO Pro Required</h2>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: 24 }}>
            AURA is currently available to ZERO Pro subscribers. Upgrade your
            account to get access.
          </p>
          <button
            onClick={() => logout()}
            style={{
              padding: "10px 24px",
              background: "var(--color-accent, #7c3aed)",
              color: "#fff",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  return <Outlet />;
}
