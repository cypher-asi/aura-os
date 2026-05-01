import type { Org, OrgMember, OrgInvite, OrgBilling, OrgRole, CreditBalance, CheckoutSessionResponse, TransactionsResponse, BillingAccount, OrgIntegration } from "../types";
import { apiFetch } from "./core";

export interface UpdateOrgPayload {
  name?: string;
  avatar_url?: string | null;
}

export const orgsApi = {
  list: () => apiFetch<Org[]>("/api/orgs"),
  create: (name: string) =>
    apiFetch<Org>("/api/orgs", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  get: (orgId: string) => apiFetch<Org>(`/api/orgs/${orgId}`),
  update: (orgId: string, data: UpdateOrgPayload) =>
    apiFetch<Org>(`/api/orgs/${orgId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  listMembers: (orgId: string) =>
    apiFetch<OrgMember[]>(`/api/orgs/${orgId}/members`),
  updateMemberRole: (orgId: string, userId: string, role: OrgRole) =>
    apiFetch<OrgMember>(`/api/orgs/${orgId}/members/${userId}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),
  removeMember: (orgId: string, userId: string) =>
    apiFetch<void>(`/api/orgs/${orgId}/members/${userId}`, {
      method: "DELETE",
    }),
  createInvite: (orgId: string) =>
    apiFetch<OrgInvite>(`/api/orgs/${orgId}/invites`, { method: "POST" }),
  listInvites: (orgId: string) =>
    apiFetch<OrgInvite[]>(`/api/orgs/${orgId}/invites`),
  revokeInvite: (orgId: string, inviteId: string) =>
    apiFetch<void>(`/api/orgs/${orgId}/invites/${inviteId}`, {
      method: "DELETE",
    }),
  acceptInvite: (token: string, displayName: string) =>
    apiFetch<OrgMember>(`/api/invites/${token}/accept`, {
      method: "POST",
      body: JSON.stringify({ displayName }),
    }),
  getBilling: (orgId: string) =>
    apiFetch<OrgBilling | null>(`/api/orgs/${orgId}/billing`),
  setBilling: (orgId: string, plan: string) =>
    apiFetch<Org>(`/api/orgs/${orgId}/billing`, {
      method: "PUT",
      body: JSON.stringify({ plan }),
    }),
  getCreditBalance: (orgId: string) =>
    apiFetch<CreditBalance>(`/api/orgs/${orgId}/credits/balance`),
  createCreditCheckout: (orgId: string, amountUsd: number) =>
    apiFetch<CheckoutSessionResponse>(`/api/orgs/${orgId}/credits/checkout`, {
      method: "POST",
      body: JSON.stringify({ amount_usd: amountUsd }),
    }),
  getTransactions: (orgId: string) =>
    apiFetch<TransactionsResponse>(`/api/orgs/${orgId}/credits/transactions`),
  getAccount: (orgId: string) =>
    apiFetch<BillingAccount>(`/api/orgs/${orgId}/account`),
  // Subscriptions
  createSubscriptionCheckout: (plan: string) =>
    apiFetch<{ url: string }>("/api/subscriptions/checkout", {
      method: "POST",
      body: JSON.stringify({ plan }),
    }),
  createPortalSession: () =>
    apiFetch<{ url: string }>("/api/subscriptions/portal", { method: "POST" }),
  getSubscriptionStatus: () =>
    apiFetch<{ plan: string; is_subscribed: boolean; monthly_credits: number; current_period_end?: string }>("/api/subscriptions/me"),
  listIntegrations: (orgId: string) =>
    apiFetch<OrgIntegration[]>(`/api/orgs/${orgId}/integrations`),
  createIntegration: (
    orgId: string,
    data: {
      name: string;
      provider: string;
      kind?: "workspace_connection" | "workspace_integration" | "mcp_server";
      default_model?: string | null;
      provider_config?: Record<string, unknown> | null;
      api_key?: string | null;
      enabled?: boolean | null;
    },
  ) =>
    apiFetch<OrgIntegration>(`/api/orgs/${orgId}/integrations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateIntegration: (
    orgId: string,
    integrationId: string,
    data: {
      name?: string;
      provider?: string;
      kind?: "workspace_connection" | "workspace_integration" | "mcp_server";
      default_model?: string | null;
      provider_config?: Record<string, unknown> | null;
      api_key?: string | null;
      enabled?: boolean | null;
    },
  ) =>
    apiFetch<OrgIntegration>(`/api/orgs/${orgId}/integrations/${integrationId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteIntegration: (orgId: string, integrationId: string) =>
    apiFetch<void>(`/api/orgs/${orgId}/integrations/${integrationId}`, {
      method: "DELETE",
    }),
};
