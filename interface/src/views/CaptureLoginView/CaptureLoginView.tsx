import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { authApi } from "../../api/auth";
import { setStoredAuth } from "../../lib/auth-token";
import { useAuthStore } from "../../stores/auth-store";
import type { AuthSession } from "../../types";
import styles from "./CaptureLoginView.module.css";

declare global {
  interface Window {
    __AURA_ENABLE_SCREENSHOT_BRIDGE__?: boolean;
  }
}

function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/desktop";
  }
  if (value.startsWith("/api/") || value.startsWith("/capture-login") || value.startsWith("/login")) {
    return "/desktop";
  }
  return value;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(normalized + padding);
}

function readCaptureSessionFromHash(hash: string): AuthSession | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const encoded = params.get("captureSession");
  if (!encoded) return null;
  try {
    const candidate = JSON.parse(decodeBase64Url(encoded)) as AuthSession;
    if (candidate?.access_token?.startsWith("aura-capture:")) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function CaptureLoginView() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const captureSession = useMemo(
    () => (typeof window === "undefined" ? null : readCaptureSessionFromHash(window.location.hash)),
    [],
  );
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!captureSession) return undefined;
    let active = true;

    void (async () => {
      setSubmitting(true);
      setError(null);
      try {
        await setStoredAuth(captureSession);
        window.__AURA_ENABLE_SCREENSHOT_BRIDGE__ = true;
        await useAuthStore.getState().restoreSession();
        if (active) {
          navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Capture session could not be restored.");
        }
      } finally {
        if (active) {
          setSubmitting(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [captureSession, navigate, searchParams]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const session = await authApi.createCaptureSession(secret);
      await setStoredAuth(session);
      window.__AURA_ENABLE_SCREENSHOT_BRIDGE__ = true;
      await useAuthStore.getState().restoreSession();
      navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Capture session could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page} data-agent-surface="capture-login">
      <section className={styles.card} aria-labelledby="capture-login-title">
        <div className={styles.header}>
          <span className={styles.eyebrow}>Aura capture mode</span>
          <h1 id="capture-login-title" className={styles.title}>Prepare a screenshot session</h1>
          <p className={styles.copy}>
            This gated flow creates a short-lived demo session for changelog media automation.
          </p>
        </div>
        {captureSession && !error ? (
          <p className={styles.copy}>Starting seeded capture session...</p>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label}>
              Capture access key
              <input
                className={styles.input}
                aria-label="Capture access key"
                data-agent-field="capture-secret"
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button className={styles.button} type="submit" disabled={submitting || !secret.trim()}>
              {submitting ? "Preparing..." : "Start capture session"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
