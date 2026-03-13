import { useState, type FormEvent } from "react";
import { Panel, Input, Button, Tabs, Heading, Text, Spinner } from "@cypher-asi/zui";
import { useAuth } from "../context/AuthContext";
import { ApiClientError } from "../api/client";
import styles from "./LoginView.module.css";

type AuthTab = "signin" | "register";

const AUTH_TABS = [
  { id: "signin", label: "Sign In" },
  { id: "register", label: "Create Account" },
];

export function LoginView() {
  const { login, register } = useAuth();
  const [activeTab, setActiveTab] = useState<AuthTab>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function resetForm(): void {
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setError(null);
  }

  function handleTabChange(id: string): void {
    setActiveTab(id as AuthTab);
    resetForm();
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }

    if (activeTab === "register" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      if (activeTab === "signin") {
        await login(email, password);
      } else {
        await register(email, password);
      }
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.body.error);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("An unexpected error occurred");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.container}>
      <Panel variant="solid" border="solid" borderRadius="lg" className={styles.card}>
        <div className={styles.header}>
          <Heading level={2}>
            <span className={styles.brand}>AURA</span>
          </Heading>
          <Text variant="muted" size="sm" className={styles.subtitle}>
            Zero Identity Authentication
          </Text>
        </div>

        <div className={styles.tabs}>
          <Tabs tabs={AUTH_TABS} value={activeTab} onChange={handleTabChange} />
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Email</label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Password</label>
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={activeTab === "signin" ? "current-password" : "new-password"}
              disabled={loading}
            />
          </div>

          {activeTab === "register" && (
            <div className={styles.field}>
              <label className={styles.fieldLabel}>Confirm Password</label>
              <Input
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                disabled={loading}
              />
            </div>
          )}

          {error && <div className={styles.error}>{error}</div>}

          <Button
            type="submit"
            variant="primary"
            className={styles.submit}
            disabled={loading}
            icon={loading ? <Spinner size="sm" /> : undefined}
          >
            {loading
              ? "Please wait..."
              : activeTab === "signin"
                ? "Sign In"
                : "Create Account"}
          </Button>
        </form>
      </Panel>
    </div>
  );
}
