import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import styles from "./RequireAuth.module.css";

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

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
