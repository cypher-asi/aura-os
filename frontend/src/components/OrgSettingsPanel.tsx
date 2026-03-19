import { useState, useEffect, useCallback, useRef } from "react";
import { useOrg } from "../context/OrgContext";
import { useAuth } from "../context/AuthContext";
import { api, ApiClientError } from "../api/client";
import { Button, Modal, Navigator, Text } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { Settings, Users, Mail, CreditCard } from "lucide-react";
import type { OrgInvite, OrgBilling, OrgRole, CreditTier, CreditBalance } from "../types";
import { useCheckoutPolling } from "../hooks/use-checkout-polling";
import { CREDITS_UPDATED_EVENT } from "./CreditsBadge";
import { OrgSettingsGeneral } from "./OrgSettingsGeneral";
import { OrgSettingsMembers } from "./OrgSettingsMembers";
import { OrgSettingsInvites } from "./OrgSettingsInvites";
import { OrgSettingsBilling } from "./OrgSettingsBilling";
import styles from "./OrgSettingsPanel.module.css";

type Section = "general" | "members" | "invites" | "billing";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: Section;
}

const NAV_ITEMS: NavigatorItemProps[] = [
  { id: "general", label: "General", icon: <Settings size={14} /> },
  { id: "members", label: "Members", icon: <Users size={14} /> },
  { id: "invites", label: "Invites", icon: <Mail size={14} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={14} /> },
];

export function OrgSettingsPanel({ isOpen, onClose, initialSection }: Props) {
  const { activeOrg, renameOrg, members, refreshMembers, refreshOrgs, isLoading } = useOrg();
  const { user } = useAuth();
  const [section, setSection] = useState<Section>(initialSection ?? "general");
  const [retryingOrg, setRetryingOrg] = useState(false);

  useEffect(() => {
    if (isOpen) setSection(initialSection ?? "general");
  }, [isOpen, initialSection]);

  const [teamName, setTeamName] = useState(activeOrg?.name ?? "");
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const [billingEmail, setBillingEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [creditTiers, setCreditTiers] = useState<CreditTier[]>([]);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [tiersLoading, setTiersLoading] = useState(false);
  const [tiersError, setTiersError] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const { status: pollingStatus, settledBalance, startPolling, reset: resetPolling } = useCheckoutPolling(activeOrg?.org_id);

  const orgId = activeOrg?.org_id;
  const myRole = members.find((m) => m.user_id === user?.user_id)?.role;
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  useEffect(() => {
    setTeamName(activeOrg?.name ?? "");
  }, [activeOrg?.name, activeOrg?.org_id]);

  const handleTeamNameChange = (value: string) => {
    setTeamName(value);
    setTeamMessage("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!activeOrg || !value.trim()) return;
    debounceRef.current = setTimeout(async () => {
      setTeamSaving(true);
      try {
        await renameOrg(activeOrg.org_id, value.trim());
        setTeamMessage("Saved");
      } catch (err) {
        setTeamMessage(err instanceof Error ? err.message : "Failed to save");
      } finally {
        setTeamSaving(false);
      }
    }, 500);
  };

  const loadInvites = useCallback(async () => {
    if (!orgId) return;
    try { setInvites(await api.orgs.listInvites(orgId)); } catch { /* ignore */ }
  }, [orgId]);

  const loadBilling = useCallback(async () => {
    if (!orgId) return;
    try {
      const b = await api.orgs.getBilling(orgId);
      setBilling(b);
      setBillingEmail(b?.billing_email ?? "");
    } catch { /* ignore */ }
  }, [orgId]);

  const loadCreditTiers = useCallback(async () => {
    if (!orgId) return;
    setTiersLoading(true);
    setTiersError(null);
    try {
      setCreditTiers(await api.orgs.getCreditTiers(orgId));
    } catch (err) {
      setTiersError(
        err instanceof ApiClientError
          ? `Billing server error (${err.status})`
          : "Unable to reach billing server"
      );
    } finally {
      setTiersLoading(false);
    }
  }, [orgId]);

  const loadCreditBalance = useCallback(async () => {
    if (!orgId) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      setCreditBalance(await api.orgs.getCreditBalance(orgId));
    } catch (err) {
      setBalanceError(
        err instanceof ApiClientError
          ? `Billing server error (${err.status})`
          : "Unable to reach billing server"
      );
    } finally {
      setBalanceLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    refreshMembers();
    loadInvites();
    loadBilling();
    loadCreditTiers();
    loadCreditBalance();
  }, [isOpen, orgId, refreshMembers, loadInvites, loadBilling, loadCreditTiers, loadCreditBalance]);

  const handleCreateInvite = async () => {
    if (!orgId) return;
    try { await api.orgs.createInvite(orgId); loadInvites(); } catch (err) { console.error("Failed to create invite", err); }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!orgId) return;
    try { await api.orgs.revokeInvite(orgId, inviteId); loadInvites(); } catch (err) { console.error("Failed to revoke invite", err); }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!orgId) return;
    try { await api.orgs.removeMember(orgId, userId); refreshMembers(); } catch (err) { console.error("Failed to remove member", err); }
  };

  const handleRoleChange = async (userId: string, role: OrgRole) => {
    if (!orgId) return;
    try { await api.orgs.updateMemberRole(orgId, userId, role); refreshMembers(); refreshOrgs(); } catch (err) { console.error("Failed to change role", err); }
  };

  const handleSaveBilling = async () => {
    if (!orgId) return;
    setSaving(true);
    try { await api.orgs.setBilling(orgId, billingEmail || null, billing?.plan ?? "free"); loadBilling(); } catch (err) { console.error("Failed to save billing", err); } finally { setSaving(false); }
  };

  const handleRetryOrg = useCallback(async () => {
    setRetryingOrg(true);
    try {
      await refreshOrgs();
    } finally {
      setRetryingOrg(false);
    }
  }, [refreshOrgs]);

  const handleBuyTier = async (tierId: string) => {
    if (!orgId) return;
    setCheckoutError(null);
    try {
      const prevBalance = creditBalance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, tierId);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      const msg = err instanceof ApiClientError
        ? `Checkout failed (${err.status})`
        : "Unable to start checkout";
      setCheckoutError(msg);
      console.error("Failed to create checkout session", err);
    }
  };

  const handleBuyCustom = async (credits: number) => {
    if (!orgId) return;
    setCheckoutError(null);
    try {
      const prevBalance = creditBalance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, undefined, credits);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      const msg = err instanceof ApiClientError
        ? `Checkout failed (${err.status})`
        : "Unable to start checkout";
      setCheckoutError(msg);
      console.error("Failed to create checkout session", err);
    }
  };

  useEffect(() => {
    if (pollingStatus === "success" && settledBalance) {
      setCreditBalance(settledBalance);
      resetPolling();
      window.dispatchEvent(new Event(CREDITS_UPDATED_EVENT));
    }
  }, [pollingStatus, settledBalance, resetPolling]);

  if (!activeOrg) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Team Settings" size="sm">
        <div className={styles.unavailableState}>
          <Text size="sm">
            {isLoading ? "Loading team settings..." : "Team settings are currently unavailable."}
          </Text>
          <Text variant="muted" size="sm">
            Aura couldn't load your team from the current host. Check the host connection and try again.
          </Text>
          <div className={styles.unavailableActions}>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" onClick={handleRetryOrg} disabled={retryingOrg || isLoading}>
              {retryingOrg ? "Retrying..." : "Retry"}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Team Settings" size="xl" noPadding fullHeight>
      <div className={styles.settingsLayout}>
        <div className={styles.settingsNav}>
          <div className={styles.navHeader}>
            <h3>{activeOrg.name}</h3>
            <span>Team settings</span>
          </div>
          <Navigator
            items={NAV_ITEMS}
            value={section}
            onChange={(id) => setSection(id as Section)}
          />
        </div>

        <div className={styles.settingsContent}>
          {section === "general" && (
            <OrgSettingsGeneral
              teamName={teamName}
              onTeamNameChange={handleTeamNameChange}
              teamSaving={teamSaving}
              teamMessage={teamMessage}
            />
          )}

          {section === "members" && (
            <OrgSettingsMembers
              members={members}
              myRole={myRole}
              currentUserId={user?.user_id}
              isAdminOrOwner={isAdminOrOwner}
              onRoleChange={handleRoleChange}
              onRemoveMember={handleRemoveMember}
            />
          )}

          {section === "invites" && (
            <OrgSettingsInvites
              invites={invites}
              isAdminOrOwner={isAdminOrOwner}
              onCreateInvite={handleCreateInvite}
              onRevokeInvite={handleRevokeInvite}
            />
          )}

          {section === "billing" && (
            <OrgSettingsBilling
              billing={billing}
              billingEmail={billingEmail}
              onBillingEmailChange={setBillingEmail}
              isAdminOrOwner={isAdminOrOwner}
              saving={saving}
              onSave={handleSaveBilling}
              tiers={creditTiers}
              balance={creditBalance}
              tiersLoading={tiersLoading}
              tiersError={tiersError}
              balanceLoading={balanceLoading}
              balanceError={balanceError}
              checkoutError={checkoutError}
              pollingStatus={pollingStatus}
              onBuyTier={handleBuyTier}
              onBuyCustom={handleBuyCustom}
              onRetryTiers={loadCreditTiers}
              onRetryBalance={loadCreditBalance}
            />
          )}

        </div>
      </div>
    </Modal>
  );
}
