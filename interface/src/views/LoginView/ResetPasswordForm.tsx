import { Input, Button, Text, Spinner } from "@cypher-asi/zui";
import styles from "./LoginView.module.css";

interface ResetPasswordFormProps {
  resetEmail: string;
  setResetEmail: (v: string) => void;
  resetStatus: "input" | "sending" | "sent" | "error";
  resetError: string;
  onSubmit: () => void;
  onClose: () => void;
}

export function ResetPasswordForm({
  resetEmail,
  setResetEmail,
  resetStatus,
  resetError,
  onSubmit,
  onClose,
}: ResetPasswordFormProps) {
  return (
    <div className={styles.form}>
      <Text size="sm" weight="medium">
        Reset Password
      </Text>

      {resetStatus === "sent" ? (
        <>
          <Text variant="muted" size="sm">
            A password reset link has been sent to <strong>{resetEmail}</strong>
          </Text>
          <Button variant="primary" onClick={onClose}>
            Back to Sign In
          </Button>
        </>
      ) : (
        <>
          <Text variant="muted" size="sm">
            Enter your ZERO account email and we&apos;ll send a reset link.
          </Text>
          <Input
            value={resetEmail}
            onChange={(e) => setResetEmail(e.target.value)}
            placeholder="Email address"
            type="email"
            autoComplete="email"
            disabled={resetStatus === "sending"}
          />
          {resetStatus === "error" && (
            <div className={styles.error}>{resetError}</div>
          )}
          <div className={styles.resetActions}>
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={resetStatus === "sending"}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={onSubmit}
              disabled={!resetEmail.trim() || resetStatus === "sending"}
              icon={
                resetStatus === "sending" ? (
                  <Spinner size="sm" className={styles.spinnerWhite} />
                ) : undefined
              }
            >
              {resetStatus === "sending" ? "Sending..." : "Send Reset Link"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
