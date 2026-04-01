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
  getSession: () => apiFetch<AuthSession>("/api/auth/session"),
  validate: () =>
    apiFetch<AuthSession>("/api/auth/validate", { method: "POST" }),
  logout: () =>
    apiFetch<void>("/api/auth/logout", { method: "POST" }),
};
