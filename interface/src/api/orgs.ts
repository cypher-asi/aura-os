import type { Org, OrgMember, OrgInvite, OrgBilling, OrgRole, CreditBalance, CheckoutSessionResponse, TransactionsResponse, BillingAccount, OrgIntegration } from "../types";
import { apiFetch } from "./core";

export const orgsApi = {
  list: () => apiFetch<Org[]>("/api/orgs"),
  create: (name: string) =>
    apiFetch<Org>("/api/orgs", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  get: (orgId: string) => apiFetch<Org>(`/api/orgs/${orgId}`),
  update: (orgId: string, name: string) =>
    apiFetch<Org>(`/api/orgs/${orgId}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
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
  setBilling: (orgId: string, billing_email: string | null, plan: string) =>
    apiFetch<Org>(`/api/orgs/${orgId}/billing`, {
      method: "PUT",
      body: JSON.stringify({ billing_email, plan }),
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
  listIntegrations: (orgId: string) =>
    apiFetch<OrgIntegration[]>(`/api/orgs/${orgId}/integrations`),
  createIntegration: (
    orgId: string,
    data: { name: string; provider: string; default_model?: string | null; api_key?: string | null },
  ) =>
    apiFetch<OrgIntegration>(`/api/orgs/${orgId}/integrations`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateIntegration: (
    orgId: string,
    integrationId: string,
    data: { name?: string; provider?: string; default_model?: string | null; api_key?: string | null },
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
