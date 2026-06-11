import { useCallback, useEffect, useId, useRef } from "react";
import { Panel, Text } from "@cypher-asi/zui";
import { X } from "lucide-react";
import { useLocation, useNavigate, type Location } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLoginForm } from "../../LoginView/use-login-form";
import { LoginForm } from "../../LoginView/LoginForm";
import { ResetPasswordForm } from "../../LoginView/ResetPasswordForm";
import loginStyles from "../../LoginView/LoginView.module.css";
import styles from "./LoginOverlay.module.css";

/**
 * Logged-out variant of `LoginView`: same auth form chrome (Sign in /
 * Create Account tabs, password reset flow) wrapped in a centered
 * modal that overlays the public chat shell instead of replacing the
 * route entirely. The shell stays mounted behind a dim backdrop so
 * the visitor can close the modal (X / Esc / click outside) and drop
 * back into "public mode" without losing their place.
 *
 * Reuses `useLoginForm`, `LoginForm`, and `ResetPasswordForm` from
 * `views/LoginView` verbatim — only the framing chrome (titlebar +
 * full-bleed video background) is dropped, since the public chat
 * shell already owns those layers.
 */
export function LoginOverlay() {
  const { t } = useTranslation("publicChat");
  const navigate = useNavigate();
  const location = useLocation();
  const headingId = useId();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const f = useLoginForm();

  const handleClose = useCallback(() => {
    // When the modal was opened from a public subpage (Product,
    // Pricing, Changelog, Feedback, …), the trigger stashed the
    // origin URL in `state.backgroundLocation`. Pop the `/login`
    // history entry to restore the prior URL + scroll position so
    // the visitor lands back exactly where they came from instead
    // of being snapped to `/`.
    const navState = location.state as
      | { backgroundLocation?: Location }
      | null;
    if (navState?.backgroundLocation) {
      navigate(-1);
      return;
    }
    // Direct deep link to `/login` (no background): preserve the
    // visitor's session id when closing so the public chat surface
    // they came from stays selected in the sidebar. Dropping the
    // query (the old `navigate("/")` behaviour) caused
    // `PublicChatView` to auto-mint a fresh empty chat on the way
    // back out — turning each open/close round trip into a new
    // "New chat" row. The `tab` selector is the only param worth
    // dropping; it belongs to the form's internal Sign in / Create
    // Account state, not the chat surface.
    const params = new URLSearchParams(location.search);
    params.delete("tab");
    const next = params.toString();
    navigate({ pathname: "/", search: next ? `?${next}` : "" });
  }, [navigate, location.state, location.search]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [handleClose]);

  const handleOverlayMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === overlayRef.current) handleClose();
    },
    [handleClose],
  );

  return (
    <div
      ref={overlayRef}
      className={styles.loginOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      onMouseDown={handleOverlayMouseDown}
    >
      <Panel
        variant="solid"
        border="solid"
        borderRadius="lg"
        className={`${loginStyles.card} ${styles.loginOverlayCard}`}
      >
        <button
          type="button"
          className={styles.loginOverlayClose}
          onClick={handleClose}
          aria-label={t("login.closeLoginAriaLabel", {
            defaultValue: "Close login",
          })}
          title={t("login.close", { defaultValue: "Close" })}
        >
          <X size={16} />
        </button>
        <Text id={headingId} align="center" className={loginStyles.cardTitle}>
          {t("login.heading", { defaultValue: "Login to AURA" })}
        </Text>

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
            recentEmails={f.recentEmails}
            addingNewEmail={f.addingNewEmail}
            onSelectEmail={f.handleSelectEmail}
            onAddAccount={f.handleAddAccount}
            onRemoveEmail={f.handleRemoveEmail}
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
  );
}
