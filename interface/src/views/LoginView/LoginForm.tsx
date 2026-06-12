import { useEffect, useRef, type FormEvent } from "react";
import { Input, Button, Tabs, Spinner } from "@cypher-asi/zui";
import { AUTH_TABS, type AuthTab } from "./use-login-form";
import { LoginEmailSelect } from "./LoginEmailSelect";
import styles from "./LoginView.module.css";

interface LoginFormProps {
  activeTab: AuthTab;
  email: string;
  setEmail: (v: string) => void;
  recentEmails: string[];
  addingNewEmail: boolean;
  onSelectEmail: (email: string) => void;
  onAddAccount: () => void;
  onRemoveEmail: (email: string) => void;
  password: string;
  setPassword: (v: string) => void;
  confirmPassword: string;
  setConfirmPassword: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  inviteCode: string;
  setInviteCode: (v: string) => void;
  error: string | null;
  loading: boolean;
  onTabChange: (id: string) => void;
  onSubmit: (e: FormEvent) => void;
  onForgotPassword: () => void;
  /** Associates an external submit button (e.g. a modal footer) with this form. */
  formId?: string;
  /** Hide the Sign In / Create Account tab switcher. */
  hideTabs?: boolean;
  /** Hide the built-in submit button (the caller provides its own). */
  hideSubmit?: boolean;
}

export function LoginForm({
  activeTab,
  email,
  setEmail,
  recentEmails,
  addingNewEmail,
  onSelectEmail,
  onAddAccount,
  onRemoveEmail,
  password,
  setPassword,
  confirmPassword,
  setConfirmPassword,
  name,
  setName,
  inviteCode,
  setInviteCode,
  error,
  loading,
  onTabChange,
  onSubmit,
  onForgotPassword,
  formId,
  hideTabs = false,
  hideSubmit = false,
}: LoginFormProps) {
  const emailRef = useRef<HTMLInputElement>(null);

  // Auto-focus the email input whenever the visitor enters the
  // form — both on initial mount AND on tab switches (Sign In ↔
  // Create Account). The mount case matters because the form is
  // typically reached by pressing Enter in the public-chat
  // textarea, which navigates straight into the login modal; the
  // tab-switch case matters because `handleTabChange` clears the
  // form so the email field becomes the first interactive control
  // again. `select()` is called alongside `focus()` so any
  // pre-filled email (e.g. seeded by a future "remember me" flow)
  // is immediately overwritable instead of requiring the visitor
  // to triple-click before typing.
  useEffect(() => {
    const node = emailRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [activeTab, addingNewEmail]);

  // On the Sign In tab, returning visitors with remembered accounts get
  // a dropdown of those accounts (plus an "Add an account" action);
  // everyone else (first-time visitors, "Add an account", the Create
  // Account tab) keeps the plain free-text email input.
  const showEmailDropdown =
    activeTab === "signin" && recentEmails.length > 0 && !addingNewEmail;

  return (
    <>
      {!hideTabs && (
        <div className={styles.tabs}>
          <Tabs tabs={AUTH_TABS} value={activeTab} onChange={onTabChange} />
        </div>
      )}

      <form id={formId} onSubmit={onSubmit} className={styles.form}>
        {showEmailDropdown ? (
          <LoginEmailSelect
            value={email}
            emails={recentEmails}
            onSelect={onSelectEmail}
            onAddAccount={onAddAccount}
            onRemove={onRemoveEmail}
            disabled={loading}
          />
        ) : (
          <Input
            ref={emailRef}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            type="email"
            autoComplete="email"
            disabled={loading}
          />
        )}

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
            onClick={onForgotPassword}
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
              placeholder="Invite code (optional)"
              type="text"
              autoComplete="off"
              disabled={loading}
            />
          </>
        )}

        {error && <div className={styles.error}>{error}</div>}

        {!hideSubmit && (
          <Button
            type="submit"
            variant="primary"
            className={styles.submit}
            disabled={loading}
            icon={
              loading ? (
                <Spinner size="sm" className={styles.spinnerWhite} />
              ) : undefined
            }
          >
            {loading
              ? "Please wait..."
              : activeTab === "signin"
                ? "Sign In"
                : "Create Account"}
          </Button>
        )}
      </form>
    </>
  );
}
