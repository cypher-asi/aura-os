import { useState, useEffect, useCallback, useRef } from "react";
import { useOrg } from "../context/OrgContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Modal, Navigator } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { Settings, Users, Mail, CreditCard, Plug } from "lucide-react";
import type { OrgInvite, OrgGithub, OrgBilling, OrgRole, GitHubIntegration, CreditTier, CreditBalance } from "../types";
import { useCheckoutPolling } from "../hooks/use-checkout-polling";
import { OrgSettingsGeneral } from "./OrgSettingsGeneral";
import { OrgSettingsMembers } from "./OrgSettingsMembers";
import { OrgSettingsInvites } from "./OrgSettingsInvites";
import { OrgSettingsBilling } from "./OrgSettingsBilling";
import { OrgSettingsIntegrations } from "./OrgSettingsIntegrations";
import styles from "./OrgSettingsPanel.module.css";

type Section = "general" | "members" | "invites" | "billing" | "integrations";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ITEMS: NavigatorItemProps[] = [
  { id: "general", label: "General", icon: <Settings size={14} /> },
  { id: "members", label: "Members", icon: <Users size={14} /> },
  { id: "invites", label: "Invites", icon: <Mail size={14} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={14} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={14} /> },
];

export function OrgSettingsPanel({ isOpen, onClose }: Props) {
  const { activeOrg, renameOrg, members, refreshMembers, refreshOrgs } = useOrg();
  const { user } = useAuth();
  const [section, setSection] = useState<Section>("general");

  const [teamName, setTeamName] = useState(activeOrg?.name ?? "");
  const [teamSaving, setTeamSaving] = useState(false);
  const [teamMessage, setTeamMessage] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const [github, setGithub] = useState<OrgGithub | null>(null);
  const [githubIntegrations, setGithubIntegrations] = useState<GitHubIntegration[]>([]);
  const [billingEmail, setBillingEmail] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [saving, setSaving] = useState(false);
  const [installLoading, setInstallLoading] = useState(false);
  const [creditTiers, setCreditTiers] = useState<CreditTier[]>([]);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const { status: pollingStatus, currentBalance: polledBalance, startPolling, reset: resetPolling } = useCheckoutPolling(activeOrg?.org_id);

  const orgId = activeOrg?.org_id;
  const myRole = members.find((m) => m.user_id === user?.user_id)?.role;
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  useEffect(() => {
    setTeamName(activeOrg?.name ?? "");
  }, [activeOrg?.org_id]);

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

  const loadGithub = useCallback(async () => {
    if (!orgId) return;
    try {
      const g = await api.orgs.getGithub(orgId);
      setGithub(g);
      setGithubOrg(g?.github_org ?? "");
    } catch { /* ignore */ }
  }, [orgId]);

  const loadGithubIntegrations = useCallback(async () => {
    if (!orgId) return;
    try { setGithubIntegrations(await api.orgs.listGithubIntegrations(orgId)); } catch { /* ignore */ }
  }, [orgId]);

  const loadCreditTiers = useCallback(async () => {
    if (!orgId) return;
    try { setCreditTiers(await api.orgs.getCreditTiers(orgId)); } catch { /* ignore */ }
  }, [orgId]);

  const loadCreditBalance = useCallback(async () => {
    if (!orgId) return;
    try { setCreditBalance(await api.orgs.getCreditBalance(orgId)); } catch { /* ignore */ }
  }, [orgId]);

  useEffect(() => {
    if (!isOpen || !orgId) return;
    refreshMembers();
    loadInvites();
    loadBilling();
    loadGithub();
    loadGithubIntegrations();
    loadCreditTiers();
    loadCreditBalance();
  }, [isOpen, orgId, refreshMembers, loadInvites, loadBilling, loadGithub, loadGithubIntegrations, loadCreditTiers, loadCreditBalance]);

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

  const handleConnectGithub = async () => {
    if (!orgId || !githubOrg.trim()) return;
    setSaving(true);
    try { await api.orgs.setGithub(orgId, githubOrg.trim()); loadGithub(); } catch (err) { console.error("Failed to connect GitHub", err); } finally { setSaving(false); }
  };

  const handleDisconnectGithub = async () => {
    if (!orgId) return;
    try { await api.orgs.removeGithub(orgId); setGithub(null); setGithubOrg(""); } catch (err) { console.error("Failed to disconnect GitHub", err); }
  };

  const handleStartInstall = async () => {
    if (!orgId) return;
    setInstallLoading(true);
    try { const { install_url } = await api.orgs.startGithubInstall(orgId); window.open(install_url, "_blank"); } catch (err) { console.error("Failed to start GitHub install", err); } finally { setInstallLoading(false); }
  };

  const handleRemoveIntegration = async (integrationId: string) => {
    if (!orgId) return;
    try { await api.orgs.removeGithubIntegration(orgId, integrationId); loadGithubIntegrations(); } catch (err) { console.error("Failed to remove integration", err); }
  };

  const handleRefreshIntegration = async (integrationId: string) => {
    if (!orgId) return;
    try { await api.orgs.refreshGithubIntegration(orgId, integrationId); loadGithubIntegrations(); } catch (err) { console.error("Failed to refresh integration", err); }
  };

  const handleBuyTier = async (tierId: string) => {
    if (!orgId) return;
    try {
      const prevBalance = creditBalance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, tierId);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      console.error("Failed to create checkout session", err);
    }
  };

  const handleBuyCustom = async (credits: number) => {
    if (!orgId) return;
    try {
      const prevBalance = creditBalance?.total_credits ?? 0;
      const { checkout_url } = await api.orgs.createCreditCheckout(orgId, undefined, credits);
      window.open(checkout_url, "_blank");
      startPolling(prevBalance);
    } catch (err) {
      console.error("Failed to create checkout session", err);
    }
  };

  // Update balance when polling succeeds
  if (pollingStatus === "success" && polledBalance !== null) {
    if (!creditBalance || creditBalance.total_credits !== polledBalance) {
      loadCreditBalance();
      resetPolling();
    }
  }

  if (!activeOrg) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Team Settings" size="full" noPadding fullHeight>
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
              pollingStatus={pollingStatus}
              onBuyTier={handleBuyTier}
              onBuyCustom={handleBuyCustom}
            />
          )}

          {section === "integrations" && (
            <OrgSettingsIntegrations
              github={github}
              githubOrg={githubOrg}
              onGithubOrgChange={setGithubOrg}
              githubIntegrations={githubIntegrations}
              isAdminOrOwner={isAdminOrOwner}
              saving={saving}
              installLoading={installLoading}
              onStartInstall={handleStartInstall}
              onRefreshIntegrations={loadGithubIntegrations}
              onRefreshIntegration={handleRefreshIntegration}
              onRemoveIntegration={handleRemoveIntegration}
              onConnectGithub={handleConnectGithub}
              onDisconnectGithub={handleDisconnectGithub}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
