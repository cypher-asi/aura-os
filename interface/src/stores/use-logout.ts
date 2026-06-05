import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "./auth-store";

/**
 * Canonical logout action for UI entry points. Clears the session via
 * `auth-store.logout()` and then navigates to the public home (`/`).
 *
 * Navigating after the session is cleared keeps every logout flow on the
 * public page instead of landing on `/login`, where `RequireAuth`'s
 * redirect would otherwise pop the `LoginOverlay` over the public surface.
 * `replace` drops the now-inaccessible authed route from history, and
 * navigating only after `logout()` resolves avoids a transient overlay
 * flash. On native (no public surface) `/` resolves through `RequireAuth`
 * to the full-page `LoginView`, preserving existing behavior.
 *
 * All logout buttons should funnel through this hook so the post-logout
 * destination stays consistent.
 *
 * The navigate runs in a `finally` so the user is always moved off the
 * (now inaccessible) authed route even if `logout()` rejects partway
 * through its best-effort local teardown — otherwise a thrown storage
 * error on web would leave them stuck on the authed surface.
 */
export function useLogout(): () => Promise<void> {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();

  return useCallback(async () => {
    try {
      await logout();
    } finally {
      navigate("/", { replace: true });
    }
  }, [logout, navigate]);
}
