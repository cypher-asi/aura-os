import type { FormEvent } from "react";
import { Input, Button, Tabs, Spinner } from "@cypher-asi/zui";
import { AUTH_TABS, type AuthTab } from "./use-login-form";
import styles from "./LoginView.module.css";

interface LoginFormProps {
  activeTab: AuthTab;
  email: string;
  setEmail: (v: string) => void;
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
}

export function LoginForm({
  activeTab,
  email,
  setEmail,
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
}: LoginFormProps) {
  return (
    <>
      <div className={styles.tabs}>
        <Tabs tabs={AUTH_TABS} value={activeTab} onChange={onTabChange} />
      </div>

      <form onSubmit={onSubmit} className={styles.form}>
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
      </form>
    </>
  );
}
