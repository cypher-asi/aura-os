import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, Navigator, Text } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { Settings, Users, Mail, CreditCard, LogOut, Plug, Gift, History, Shield } from "lucide-react";
import { OrgSettingsGeneral } from "../OrgSettingsGeneral";
import { OrgSettingsMembers } from "../OrgSettingsMembers";
import { OrgSettingsInvites } from "../OrgSettingsInvites";
import { OrgSettingsBilling } from "../OrgSettingsBilling";
import { OrgSettingsRewards } from "../OrgSettingsRewards";
import { OrgSettingsCreditHistory } from "../OrgSettingsCreditHistory/OrgSettingsCreditHistory";
import { OrgSettingsPrivacy } from "../OrgSettingsPrivacy/OrgSettingsPrivacy";
import { TierSubscriptionModal } from "../TierSubscriptionModal";
import { useAuth } from "../../stores/auth-store";
import { track } from "../../lib/analytics";
import { useOrgSettingsData } from "./useOrgSettingsData";
import styles from "./OrgSettingsPanel.module.css";

type Section = "general" | "members" | "invites" | "billing" | "rewards" | "credit-history" | "privacy";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: Section;
}

const NAV_ITEMS: NavigatorItemProps[] = [
  { id: "general", label: "General", icon: <Settings size={14} /> },
  { id: "members", label: "Members", icon: <Users size={14} /> },
  { id: "invites", label: "Invites", icon: <Mail size={14} /> },
  { id: "rewards", label: "Rewards", icon: <Gift size={14} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={14} /> },
  { id: "credit-history", label: "Z Credit History", icon: <History size={14} /> },
  { id: "privacy", label: "Privacy", icon: <Shield size={14} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={14} /> },
];

function OrgSettingsContent({ data, onUpgrade }: { data: ReturnType<typeof useOrgSettingsData>; onUpgrade: () => void }) {
  return (
    <>
      {data.section === "general" && (
        <OrgSettingsGeneral
          teamName={data.teamName}
          teamAvatarUrl={data.teamAvatarUrl}
          onTeamNameChange={data.handleTeamNameChange}
          onTeamAvatarChange={data.handleTeamAvatarChange}
          teamSaving={data.teamSaving}
          teamMessage={data.teamMessage}
        />
      )}
      {data.section === "members" && (
        <OrgSettingsMembers members={data.members} myRole={data.myRole} currentUserId={data.user?.user_id} isAdminOrOwner={data.isAdminOrOwner} onRoleChange={data.handleRoleChange} onRemoveMember={data.handleRemoveMember} />
      )}
      {data.section === "invites" && (
        <OrgSettingsInvites invites={data.invites} isAdminOrOwner={data.isAdminOrOwner} onCreateInvite={data.handleCreateInvite} onRevokeInvite={data.handleRevokeInvite} />
      )}
      {data.section === "rewards" && (
        <OrgSettingsRewards />
      )}
      {data.section === "billing" && (
        <OrgSettingsBilling billing={data.billing} isAdminOrOwner={data.isAdminOrOwner} balance={data.balance} balanceLoading={data.balanceLoading} balanceError={data.balanceError} checkoutError={data.checkoutError} pollingStatus={data.pollingStatus} onPurchase={data.handlePurchase} onRetryBalance={data.loadCreditBalance} onUpgrade={onUpgrade} />
      )}
      {data.section === "credit-history" && (
        <OrgSettingsCreditHistory />
      )}
      {data.section === "privacy" && (
        <OrgSettingsPrivacy />
      )}
    </>
  );
}

export function OrgSettingsPanel({ isOpen, onClose, initialSection }: Props) {
  const data = useOrgSettingsData(isOpen, initialSection);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tierModalOpen, setTierModalOpen] = useState(false);

  useEffect(() => { if (isOpen) track("settings_opened"); }, [isOpen]);

  const handleNavChange = (id: string) => {
    // Integrations were promoted to a top-level app. Keep the tab in the
    // Team Settings nav for discoverability, but clicking it closes the
    // modal and deep-links into the Integrations app instead of rendering
    // the old inline form.
    if (id === "integrations") {
      onClose();
      navigate("/integrations");
      return;
    }
    data.setSection(id as Section);
  };

  if (!data.activeOrg) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Team Settings" size="sm">
        <div className={styles.unavailableState}>
          <Text size="sm">{data.isLoading ? "Loading team settings..." : "Team settings are currently unavailable."}</Text>
          <Text variant="muted" size="sm">Aura couldn't load your team from the current host. Check the host connection and try again.</Text>
          <div className={styles.unavailableActions}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button variant="primary" onClick={data.handleRetryOrg} disabled={data.retryingOrg || data.isLoading}>
              {data.retryingOrg ? "Retrying..." : "Retry"}
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
            <h3>{data.activeOrg.name}</h3>
            <span>Team settings</span>
          </div>
          <Navigator items={NAV_ITEMS} value={data.section} onChange={handleNavChange} />
          <div className={styles.navFooter}>
            <Button
              variant="ghost"
              size="sm"
              icon={<LogOut size={14} />}
              className={styles.logoutButton}
              onClick={() => { void logout(); }}
            >
              Logout
            </Button>
          </div>
        </div>
        <div className={styles.settingsContent}>
          <OrgSettingsContent data={data} onUpgrade={() => setTierModalOpen(true)} />
        </div>
      </div>
      <TierSubscriptionModal isOpen={tierModalOpen} onClose={() => setTierModalOpen(false)} />
    </Modal>
  );
}
