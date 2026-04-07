import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrgStore } from "../../stores/org-store";
import { useAuth } from "../../stores/auth-store";
import { useBillingStore } from "../../stores/billing-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { api, ApiClientError } from "../../api/client";
import type { OrgBilling, OrgInvite, OrgRole } from "../../types";
import { useCheckoutPolling } from "../../hooks/use-checkout-polling";
import { CREDITS_UPDATED_EVENT } from "../CreditsBadge";
import { NATIVE_BILLING_MESSAGE } from "../../lib/billing";

type Section = "general" | "members" | "invites" | "billing" | "integrations";

export function useOrgSettingsData(isOpen: boolean, initialSection?: Section) {
  const { isNativeApp } = useAuraCapabilities();
  const { activeOrg, renameOrg, members, integrations, refreshMembers, refreshIntegrations, refreshOrgs, isLoading } = useOrgStore(
    useShallow((s) => ({
      activeOrg: s.activeOrg, renameOrg: s.renameOrg, members: s.members,
      integrations: s.integrations, refreshMembers: s.refreshMembers, refreshIntegrations: s.refreshIntegrations,
      refreshOrgs: s.refreshOrgs, isLoading: s.isLoading,
    })),
  );
  const { user } = useAuth();
  const [section, setSection] = useState<Section>(initialSection ?? "general");
  const [retryingOrg, setRetryingOrg] = useState(false);

  useEffect(() => { if (isOpen) setSection(initialSection ?? "general"); }, [isOpen, initialSection]);

  const [teamName, setTeamName] = useState(activeOrg?.name ?? "");
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [integrationBusyId, setIntegrationBusyId] = useState<string | null>(null);

  const balance = useBillingStore((s) => s.balance);
  const balanceLoading = useBillingStore((s) => s.balanceLoading);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const { status: pollingStatus, settledBalance, startPolling, reset: resetPolling } = useCheckoutPolling(activeOrg?.org_id);

  const orgId = activeOrg?.org_id;
  const myRole = members.find((m) => m.user_id === user?.network_user_id)?.role;
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  useEffect(() => { setTeamName(activeOrg?.name ?? ""); }, [activeOrg?.name, activeOrg?.org_id]);

  const handleTeamNameChange = (value: string) => {
    setTeamName(value); setTeamMessage("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!activeOrg || !value.trim()) return;
    debounceRef.current = setTimeout(async () => {
      setTeamSaving(true);
      try { await renameOrg(activeOrg.org_id, value.trim()); setTeamMessage("Saved"); }
      catch (err) { setTeamMessage(err instanceof Error ? err.message : "Failed to save"); }
      finally { setTeamSaving(false); }
    }, 500);
  };

  const loadInvites = useCallback(async () => {
    if (!orgId) return;
    try { setInvites(await api.orgs.listInvites(orgId)); } catch { /* ignore */ }
  }, [orgId]);

  const loadBilling = useCallback(async () => {
    if (!orgId) return;
    try { const b = await api.orgs.getBilling(orgId); setBilling(b); setBillingEmail(b?.billing_email ?? ""); } catch { /* ignore */ }
  }, [orgId]);

  const loadCreditBalance = useCallback(async () => {
    if (!orgId) return;
    setBalanceError(null);
    try { await useBillingStore.getState().fetchBalance(orgId); }
    catch (err) { setBalanceError(err instanceof ApiClientError ? `Billing server error (${err.status})` : "Unable to reach billing server"); }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    refreshMembers(); refreshIntegrations(); loadInvites(); loadBilling(); loadCreditBalance();
  }, [isOpen, orgId, refreshMembers, refreshIntegrations, loadInvites, loadBilling, loadCreditBalance]);

  const handleCreateInvite = async () => { if (orgId) { try { await api.orgs.createInvite(orgId); loadInvites(); } catch (err) { console.error("Failed to create invite", err); } } };
  const handleRevokeInvite = async (inviteId: string) => { if (orgId) { try { await api.orgs.revokeInvite(orgId, inviteId); loadInvites(); } catch (err) { console.error("Failed to revoke invite", err); } } };
  const handleRemoveMember = async (userId: string) => { if (orgId) { try { await api.orgs.removeMember(orgId, userId); refreshMembers(); } catch (err) { console.error("Failed to remove member", err); } } };
  const handleRoleChange = async (userId: string, role: OrgRole) => { if (orgId) { try { await api.orgs.updateMemberRole(orgId, userId, role); refreshMembers(); refreshOrgs(); } catch (err) { console.error("Failed to change role", err); } } };
  const handleSaveBilling = async () => { if (orgId) { setSaving(true); try { await api.orgs.setBilling(orgId, billingEmail || null, billing?.plan ?? "free"); loadBilling(); } catch (err) { console.error("Failed to save billing", err); } finally { setSaving(false); } } };
  const createIntegration = useCallback(async (data: {
    name: string;
    provider: string;
    kind?: "workspace_connection" | "workspace_integration" | "mcp_server";
    default_model?: string | null;
    provider_config?: Record<string, unknown> | null;
    api_key?: string | null;
    enabled?: boolean | null;
  }) => {
    if (!orgId) return null;
    setIntegrationBusyId("new");
    try {
      const integration = await api.orgs.createIntegration(orgId, data);
      await refreshIntegrations();
      return integration;
    } finally {
      setIntegrationBusyId(null);
    }
  }, [orgId, refreshIntegrations]);
  const updateIntegration = useCallback(async (
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
  ) => {
    if (!orgId) return null;
    setIntegrationBusyId(integrationId);
    try {
      const integration = await api.orgs.updateIntegration(orgId, integrationId, data);
      await refreshIntegrations();
      return integration;
    } finally {
      setIntegrationBusyId(null);
    }
  }, [orgId, refreshIntegrations]);
  const deleteIntegration = useCallback(async (integrationId: string) => {
    if (!orgId) return;
    setIntegrationBusyId(integrationId);
    try {
      await api.orgs.deleteIntegration(orgId, integrationId);
      await refreshIntegrations();
    } finally {
      setIntegrationBusyId(null);
    }
  }, [orgId, refreshIntegrations]);

  const handleRetryOrg = useCallback(async () => { setRetryingOrg(true); try { await refreshOrgs(); } finally { setRetryingOrg(false); } }, [refreshOrgs]);

  const handlePurchase = useCallback(async (amountUsd: number) => {
    if (!orgId) return;
    // Mirror the modal safeguard here because org billing has its own purchase
    // entry point and should follow the same native-app policy.
    if (isNativeApp) {
      setCheckoutError(NATIVE_BILLING_MESSAGE);
      return;
    }
    setCheckoutError(null);
    const result = await useBillingStore.getState().purchase(orgId, amountUsd);
    if (result?.checkout_url) {
      window.open(result.checkout_url, "_blank");
      const prevBalance = useBillingStore.getState().balance?.balance_cents ?? 0;
      startPolling(prevBalance);
    }
  }, [isNativeApp, orgId, startPolling]);

  useEffect(() => {
    if (pollingStatus === "success" && settledBalance) {
      useBillingStore.setState({ balance: settledBalance });
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
  }, [pollingStatus, settledBalance, resetPolling]);

  return {
    activeOrg, isLoading, user, section, setSection, retryingOrg,
    teamName, handleTeamNameChange, teamSaving, teamMessage,
    members, myRole, isAdminOrOwner,
    integrations, integrationBusyId, createIntegration, updateIntegration, deleteIntegration,
    invites, handleCreateInvite, handleRevokeInvite,
    handleRemoveMember, handleRoleChange,
    billing, billingEmail, setBillingEmail, saving, handleSaveBilling,
    balance, balanceLoading, balanceError,
    checkoutError, pollingStatus, handlePurchase,
    loadCreditBalance, handleRetryOrg,
  };
}
