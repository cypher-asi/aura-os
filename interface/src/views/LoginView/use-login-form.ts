import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../stores/auth-store";
import { useHostStore, type HostConnectionStatus } from "../../stores/host-store";
import {
  getHostDisplayLabel,
  getTargetHostOrigin,
  requiresExplicitHostOrigin,
} from "../../shared/lib/host-config";
import { getAuthErrorMessage } from "../../shared/utils/api-errors";
import { authApi } from "../../shared/api/auth";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useShallow } from "zustand/react/shallow";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import {
  addRecentLoginEmail,
  getRecentLoginEmails,
  removeRecentLoginEmail,
} from "../../utils/storage";

export type AuthTab = "signin" | "register";

export const AUTH_TABS = [
  { id: "signin", label: "Sign In" },
  { id: "register", label: "Create Account" },
];

export const HOST_BADGE_VARIANT: Record<
  HostConnectionStatus,
  "running" | "pending" | "error"
> = {
  checking: "pending",
  online: "running",
  auth_required: "running",
  unreachable: "error",
  error: "error",
};

const HOST_STATUS_COPY: Record<
  HostConnectionStatus,
  { title: string; detail: string }
> = {
  checking: {
    title: "Checking Aura host",
    detail: "We\u2019re verifying the configured host before sign-in.",
  },
  online: {
    title: "Host reachable",
    detail: "You can sign in against this Aura host now.",
  },
  auth_required: {
    title: "Sign in required",
    detail: "The host is reachable and ready for authentication.",
  },
  unreachable: {
    title: "Host unreachable",
    detail:
      "We couldn\u2019t reach the configured Aura host. Update the host target or retry the connection check.",
  },
  error: {
    title: "Host check failed",
    detail:
      "Aura returned an unexpected error while checking the host connection.",
  },
};

export function useLoginForm() {
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const status = useHostStore((s) => s.status);
  const refreshStatus = useHostStore((s) => s.refreshStatus);
  const hostLabel = getHostDisplayLabel();
  const { features, isMobileLayout, isNativeApp } = useAuraCapabilities();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } })?.from?.pathname ?? "/";

  const [activeTab, setActiveTab] = useState<AuthTab>("signin");
  // Seed `activeTab` from `?tab=register` (or `?tab=signin`) on mount
  // so the "Sign Up" CTA in the logged-out shell deep-links
  // straight into the Create Account form. Runs once — subsequent
  // navigation between tabs uses `handleTabChange`.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get("tab");
    if (tab === "register" || tab === "signin") {
      setActiveTab(tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Remembered accounts power the Sign In email dropdown. Seed `email`
  // with the most-recent account so a returning visitor can sign in
  // with one tap; `addingNewEmail` flips the field back to free-text
  // entry when the visitor chooses "Add an account".
  const [recentEmails, setRecentEmails] = useState<string[]>(() =>
    getRecentLoginEmails(),
  );
  const [addingNewEmail, setAddingNewEmail] = useState(
    () => recentEmails.length === 0,
  );
  const [email, setEmail] = useState(() => recentEmails[0] ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<
    "input" | "sending" | "sent" | "error"
  >("input");
  const [resetError, setResetError] = useState("");
  const { hostSettingsOpen, openHostSettings, closeHostSettings } =
    useUIModalStore(
      useShallow((s) => ({
        hostSettingsOpen: s.hostSettingsOpen,
        openHostSettings: s.openHostSettings,
        closeHostSettings: s.closeHostSettings,
      })),
    );
  const [hostRefreshing, setHostRefreshing] = useState(false);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    navigate(from === "/login" ? "/" : from, { replace: true });
  }, [from, isAuthenticated, isLoading, navigate]);

  function resetForm(): void {
    setPassword("");
    setConfirmPassword("");
    setName("");
    setInviteCode("");
    setError(null);
  }

  function handleSelectEmail(value: string): void {
    setEmail(value);
    setAddingNewEmail(false);
  }

  function handleAddAccount(): void {
    setEmail("");
    setAddingNewEmail(true);
  }

  function handleRemoveEmail(value: string): void {
    removeRecentLoginEmail(value);
    const next = getRecentLoginEmails();
    setRecentEmails(next);
    if (next.length === 0) {
      setEmail("");
      setAddingNewEmail(true);
      return;
    }
    // If the removed account was the selected one, fall back to the
    // next most-recent so the dropdown never points at a forgotten
    // address.
    if (!next.some((e) => e.toLowerCase() === value.trim().toLowerCase())) {
      setEmail((current) =>
        current.trim().toLowerCase() === value.trim().toLowerCase()
          ? next[0]
          : current,
      );
    }
  }

  function openResetPassword(): void {
    setResetEmail(email);
    setResetStatus("input");
    setResetError("");
    setShowResetPassword(true);
  }

  function closeResetPassword(): void {
    setShowResetPassword(false);
  }

  async function handleResetSubmit(): Promise<void> {
    if (!resetEmail.trim()) return;
    setResetStatus("sending");
    try {
      await authApi.requestPasswordReset(resetEmail.trim());
      setResetStatus("sent");
    } catch (err) {
      setResetError(
        err instanceof Error ? err.message : "Failed to send reset email",
      );
      setResetStatus("error");
    }
  }

  function handleTabChange(id: string): void {
    const tab = id as AuthTab;
    setActiveTab(tab);
    resetForm();
    // The remembered-account dropdown only applies to Sign In. Creating
    // an account always means typing a fresh address, so the Create
    // Account tab uses free-text entry; returning to Sign In restores
    // the dropdown (and the most-recent account) when one exists.
    if (tab === "signin" && recentEmails.length > 0) {
      setEmail(recentEmails[0]);
      setAddingNewEmail(false);
    } else {
      setEmail("");
      setAddingNewEmail(true);
    }
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Email and password are required");
      return;
    }

    if (isNativeApp && requiresExplicitHostOrigin() && !getTargetHostOrigin()) {
      setError("Set an Aura host before signing in.");
      openHostSettings();
      return;
    }

    if (activeTab === "register") {
      if (password !== confirmPassword) {
        setError("Passwords do not match");
        return;
      }
      if (!name.trim()) {
        setError("Name is required");
        return;
      }
    }

    const trimmedEmail = email.trim();
    setLoading(true);
    try {
      if (activeTab === "signin") {
        await login(email, password);
      } else {
        const trimmedCode = inviteCode.trim();
        let finalCode = trimmedCode;

        if (trimmedCode) {
          // Validate the user-entered invite code before submitting
          const result = await authApi.validateInviteCode(trimmedCode);
          if (!result.valid) {
            setError("Invalid invite code");
            return;
          }
        } else {
          // Use default invite code when none provided
          finalCode = import.meta.env.VITE_DEFAULT_INVITE_CODE ?? "domw-jh4cz8";
        }

        await register(email, password, name.trim(), finalCode);
      }
      // Remember the email only after a successful auth so failed
      // attempts (typos, wrong password) don't pollute the dropdown.
      addRecentLoginEmail(trimmedEmail);
      setRecentEmails(getRecentLoginEmails());
      await refreshStatus();
      navigate(from, { replace: true });
    } catch (err) {
      setError(getAuthErrorMessage(err, hostLabel));
    } finally {
      setLoading(false);
    }
  }

  async function handleRefreshHost(): Promise<void> {
    setHostRefreshing(true);
    try {
      await refreshStatus();
    } finally {
      setHostRefreshing(false);
    }
  }

  const missingNativeHost =
    isNativeApp && requiresExplicitHostOrigin() && !getTargetHostOrigin();
  const hostStatus = missingNativeHost
    ? {
        title: "Aura host required",
        detail:
          "Native mobile builds need a configured Aura host before sign-in.",
      }
    : HOST_STATUS_COPY[status];
  const showHostWarning = status === "unreachable" || status === "error";
  const showCompactHostStatus =
    isMobileLayout && (status === "online" || status === "auth_required");

  return {
    activeTab,
    email,
    setEmail,
    recentEmails,
    addingNewEmail,
    handleSelectEmail,
    handleAddAccount,
    handleRemoveEmail,
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
    showResetPassword,
    resetEmail,
    setResetEmail,
    resetStatus,
    resetError,
    status,
    hostLabel,
    hostRefreshing,
    hostSettingsOpen,
    hostStatus,
    showHostWarning,
    showCompactHostStatus,
    features,
    isMobileLayout,
    handleTabChange,
    handleSubmit,
    handleRefreshHost,
    openResetPassword,
    closeResetPassword,
    handleResetSubmit,
    openHostSettings,
    closeHostSettings,
  };
}
