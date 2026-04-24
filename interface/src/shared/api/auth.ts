import type { AuthSession } from "../types";
import { apiFetch } from "./core";

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<AuthSession>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  register: (email: string, password: string, name: string, inviteCode: string) =>
    apiFetch<AuthSession>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, name, invite_code: inviteCode }),
    }),
  validateInviteCode: (code: string) =>
    apiFetch<{ valid: boolean }>(`/api/invite/${encodeURIComponent(code)}/validate`, {
      method: "POST",
    }),
  getMyInviteCode: () =>
    apiFetch<{ slug: string }>("/api/invite/me", { method: "POST" }),
  getSession: () => apiFetch<AuthSession>("/api/auth/session"),
  validate: () =>
    apiFetch<AuthSession>("/api/auth/validate", { method: "POST" }),
  logout: () =>
    apiFetch<void>("/api/auth/logout", { method: "POST" }),
  requestPasswordReset: (email: string) =>
    apiFetch<void>("/api/auth/request-password-reset", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  createCaptureSession: (secret: string) =>
    apiFetch<AuthSession>("/api/capture/session", {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),
  redeemAccessCode: (code: string) =>
    apiFetch<{ code: string; maxUses: number; useCount: number }>("/api/auth/redeem-access-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
  getAccessCode: () =>
    apiFetch<{ code: string; maxUses: number; useCount: number } | null>("/api/auth/access-codes"),
};
