import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Spinner } from "@cypher-asi/zui";
import { useAuth } from "../../stores/auth-store";
import styles from "./RequireAuth.module.css";

export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
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

  return <Outlet />;
}
