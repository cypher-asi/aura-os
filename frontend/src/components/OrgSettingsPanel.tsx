import { useState, useEffect, useCallback } from "react";
import { useOrg } from "../context/OrgContext";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { Modal, Button, Input, Text } from "@cypher-asi/zui";
import { Copy, Trash2, UserMinus } from "lucide-react";
import type { OrgInvite, OrgGithub, OrgBilling, OrgRole } from "../types";
import styles from "./OrgSettingsPanel.module.css";

type Tab = "members" | "invites" | "billing" | "integrations";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function OrgSettingsPanel({ isOpen, onClose }: Props) {
  const { activeOrg, members, refreshMembers, refreshOrgs } = useOrg();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("members");
  const [invites, setInvites] = useState<OrgInvite[]>([]);
  const [billing, setBilling] = useState<OrgBilling | null>(null);
  const [github, setGithub] = useState<OrgGithub | null>(null);

  const [billingEmail, setBillingEmail] = useState("");
  const [githubOrg, setGithubOrg] = useState("");
  const [saving, setSaving] = useState(false);

  const orgId = activeOrg?.org_id;
  const myRole = members.find((m) => m.user_id === user?.user_id)?.role;
  const isAdminOrOwner = myRole === "owner" || myRole === "admin";

  const loadInvites = useCallback(async () => {
    if (!orgId) return;
    try {
      setInvites(await api.orgs.listInvites(orgId));
    } catch { /* ignore */ }
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

  useEffect(() => {
    if (!isOpen || !orgId) return;
    refreshMembers();
    loadInvites();
    loadBilling();
    loadGithub();
  }, [isOpen, orgId, refreshMembers, loadInvites, loadBilling, loadGithub]);

  const handleCreateInvite = async () => {
    if (!orgId) return;
    try {
      await api.orgs.createInvite(orgId);
      loadInvites();
    } catch (err) {
      console.error("Failed to create invite", err);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!orgId) return;
    try {
      await api.orgs.revokeInvite(orgId, inviteId);
      loadInvites();
    } catch (err) {
      console.error("Failed to revoke invite", err);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!orgId) return;
    try {
      await api.orgs.removeMember(orgId, userId);
      refreshMembers();
    } catch (err) {
      console.error("Failed to remove member", err);
    }
  };

  const handleRoleChange = async (userId: string, role: OrgRole) => {
    if (!orgId) return;
    try {
      await api.orgs.updateMemberRole(orgId, userId, role);
      refreshMembers();
      refreshOrgs();
    } catch (err) {
      console.error("Failed to change role", err);
    }
  };

  const handleSaveBilling = async () => {
    if (!orgId) return;
    setSaving(true);
    try {
      await api.orgs.setBilling(orgId, billingEmail || null, billing?.plan ?? "free");
      loadBilling();
    } catch (err) {
      console.error("Failed to save billing", err);
    } finally {
      setSaving(false);
    }
  };

  const handleConnectGithub = async () => {
    if (!orgId || !githubOrg.trim()) return;
    setSaving(true);
    try {
      await api.orgs.setGithub(orgId, githubOrg.trim());
      loadGithub();
    } catch (err) {
      console.error("Failed to connect GitHub", err);
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnectGithub = async () => {
    if (!orgId) return;
    try {
      await api.orgs.removeGithub(orgId);
      setGithub(null);
      setGithubOrg("");
    } catch (err) {
      console.error("Failed to disconnect GitHub", err);
    }
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
  };

  if (!activeOrg) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "members", label: "Members" },
    { key: "invites", label: "Invites" },
    { key: "billing", label: "Billing" },
    { key: "integrations", label: "Integrations" },
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={activeOrg.name} size="lg">
      <div className={styles.panel}>
        <div className={styles.tabs}>
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`${styles.tab} ${tab === t.key ? styles.activeTab : ""}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.content}>
          {tab === "members" && (
            <div className={styles.membersList}>
              {members.map((m) => (
                <div key={m.user_id} className={styles.memberRow}>
                  <span className={styles.memberName}>{m.display_name}</span>
                  {myRole === "owner" && m.user_id !== user?.user_id ? (
                    <select
                      className={styles.roleSelect}
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.user_id, e.target.value as OrgRole)}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                      <option value="owner">Owner</option>
                    </select>
                  ) : (
                    <span className={styles.roleBadge}>{m.role}</span>
                  )}
                  {isAdminOrOwner && m.role !== "owner" && m.user_id !== user?.user_id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<UserMinus size={14} />}
                      iconOnly
                      aria-label="Remove member"
                      onClick={() => handleRemoveMember(m.user_id)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {tab === "invites" && (
            <div className={styles.invitesSection}>
              {isAdminOrOwner && (
                <Button variant="primary" size="sm" onClick={handleCreateInvite}>
                  Generate Invite Link
                </Button>
              )}
              <div className={styles.invitesList}>
                {invites
                  .filter((i) => i.status === "pending")
                  .map((inv) => (
                    <div key={inv.invite_id} className={styles.inviteRow}>
                      <code className={styles.inviteToken}>
                        {`${window.location.origin}/invite/${inv.token}`}
                      </code>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Copy size={14} />}
                        iconOnly
                        aria-label="Copy link"
                        onClick={() => copyInviteLink(inv.token)}
                      />
                      {isAdminOrOwner && (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          iconOnly
                          aria-label="Revoke"
                          onClick={() => handleRevokeInvite(inv.invite_id)}
                        />
                      )}
                    </div>
                  ))}
                {invites.filter((i) => i.status === "pending").length === 0 && (
                  <Text variant="muted" size="sm">
                    No pending invites
                  </Text>
                )}
              </div>
            </div>
          )}

          {tab === "billing" && (
            <div className={styles.billingSection}>
              <Text variant="muted" size="sm">
                Plan: {billing?.plan ?? "free"}
              </Text>
              {isAdminOrOwner && (
                <div className={styles.billingForm}>
                  <Input
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    placeholder="Billing email"
                  />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveBilling}
                    disabled={saving}
                  >
                    {saving ? "Saving..." : "Save"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === "integrations" && (
            <div className={styles.integrationsSection}>
              {github ? (
                <div className={styles.githubConnected}>
                  <Text size="sm">
                    Connected: <strong>{github.github_org}</strong>
                  </Text>
                  {isAdminOrOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDisconnectGithub}
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              ) : (
                isAdminOrOwner && (
                  <div className={styles.githubForm}>
                    <Input
                      value={githubOrg}
                      onChange={(e) => setGithubOrg(e.target.value)}
                      placeholder="GitHub organization name"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleConnectGithub}
                      disabled={saving || !githubOrg.trim()}
                    >
                      Connect
                    </Button>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
