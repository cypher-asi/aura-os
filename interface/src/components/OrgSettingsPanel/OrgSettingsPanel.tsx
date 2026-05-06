import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Modal, Navigator, Text } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { OverlayScrollbar } from "../OverlayScrollbar";
import {
  Settings,
  Users,
  Mail,
  CreditCard,
  LogOut,
  Plug,
  Gift,
  History,
  Shield,
  Paintbrush,
  Info,
  Bell,
  Keyboard,
} from "lucide-react";
import { OrgSettingsGeneral } from "../OrgSettingsGeneral";
import { OrgSettingsMembers } from "../OrgSettingsMembers";
import { OrgSettingsInvites } from "../OrgSettingsInvites";
import { OrgSettingsBilling } from "../OrgSettingsBilling";
import { OrgSettingsRewards } from "../OrgSettingsRewards";
import { OrgSettingsCreditHistory } from "../OrgSettingsCreditHistory/OrgSettingsCreditHistory";
import { OrgSettingsPrivacy } from "../OrgSettingsPrivacy/OrgSettingsPrivacy";
import { AppearanceSection } from "../../views/SettingsView/AppearanceSection";
import { AboutSection } from "../../views/SettingsView/AboutSection";
import { NotificationsSection } from "../../views/SettingsView/NotificationsSection";
import { KeyboardSection } from "../../views/SettingsView/KeyboardSection";
import { AdvancedSection } from "../../views/SettingsView/AdvancedSection";
import { TierSubscriptionModal } from "../TierSubscriptionModal";
import { useAuth } from "../../stores/auth-store";
import { track } from "../../lib/analytics";
import { useOrgSettingsData, isOrgSection, type Section } from "./useOrgSettingsData";
import styles from "./OrgSettingsPanel.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: Section;
}

// App-scoped sections — work without an active org. Listed first so users
// looking for theme/appearance controls land here naturally.
const APP_NAV_ITEMS: NavigatorItemProps[] = [
  { id: "appearance", label: "Appearance", icon: <Paintbrush size={14} /> },
  { id: "notifications", label: "Notifications", icon: <Bell size={14} /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard size={14} /> },
  { id: "about", label: "About", icon: <Info size={14} /> },
  { id: "advanced", label: "Advanced", icon: <Settings size={14} /> },
];

// Team-scoped sections — require an active org context to be meaningful.
const ORG_NAV_ITEMS: NavigatorItemProps[] = [
  { id: "general", label: "General", icon: <Settings size={14} /> },
  { id: "members", label: "Members", icon: <Users size={14} /> },
  { id: "invites", label: "Invites", icon: <Mail size={14} /> },
  { id: "rewards", label: "Rewards", icon: <Gift size={14} /> },
  { id: "billing", label: "Billing", icon: <CreditCard size={14} /> },
  { id: "credit-history", label: "Z Credit History", icon: <History size={14} /> },
  { id: "privacy", label: "Privacy", icon: <Shield size={14} /> },
  { id: "integrations", label: "Integrations", icon: <Plug size={14} /> },
];

function OrgSectionContent({ data, onUpgrade }: { data: ReturnType<typeof useOrgSettingsData>; onUpgrade: () => void }) {
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
        <OrgSettingsRewards onUpgrade={onUpgrade} />
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

function AppSectionContent({ section }: { section: Section }) {
  switch (section) {
    case "appearance":
      return <AppearanceSection />;
    case "notifications":
      return <NotificationsSection />;
    case "keyboard":
      return <KeyboardSection />;
    case "about":
      return <AboutSection />;
    case "advanced":
      return <AdvancedSection />;
    default:
      return null;
  }
}

export function OrgSettingsPanel({ isOpen, onClose, initialSection }: Props) {
  const data = useOrgSettingsData(isOpen, initialSection);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [tierModalOpen, setTierModalOpen] = useState(false);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (isOpen) track("settings_opened"); }, [isOpen]);

  const handleNavChange = (id: string) => {
    // Integrations were promoted to a top-level app. Keep the tab in the
    // nav for discoverability, but clicking it closes the modal and
    // deep-links into the Integrations app instead of rendering the old
    // inline form.
    if (id === "integrations") {
      onClose();
      navigate("/integrations");
      return;
    }
    data.setSection(id as Section);
  };

  // App-scoped sections render regardless of org availability so users can
  // always reach Appearance / About / etc. even when no team is loaded.
  const onOrgSection = isOrgSection(data.section);
  const orgUnavailable = !data.activeOrg;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="xl" noPadding fullHeight>
      <div className={styles.settingsLayout}>
        <div className={styles.settingsNav}>
          <div ref={navScrollRef} className={styles.settingsNavScroll}>
            <div className={styles.navHeader}>
              <h3>{data.activeOrg?.name ?? "Settings"}</h3>
              <span>{data.activeOrg ? "Team settings" : "App settings"}</span>
            </div>
            <div className={styles.navGroupLabel}>App</div>
            <Navigator items={APP_NAV_ITEMS} value={data.section} onChange={handleNavChange} />
            <div className={styles.navGroupLabel}>Team</div>
            <Navigator items={ORG_NAV_ITEMS} value={data.section} onChange={handleNavChange} />
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
          <OverlayScrollbar scrollRef={navScrollRef} />
        </div>
        <div className={styles.settingsContent}>
          <div ref={contentScrollRef} className={styles.settingsContentScroll}>
            {onOrgSection && orgUnavailable ? (
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
            ) : onOrgSection ? (
              <OrgSectionContent data={data} onUpgrade={() => setTierModalOpen(true)} />
            ) : (
              <AppSectionContent section={data.section} />
            )}
          </div>
          <OverlayScrollbar scrollRef={contentScrollRef} />
        </div>
      </div>
      <TierSubscriptionModal isOpen={tierModalOpen} onClose={() => setTierModalOpen(false)} />
    </Modal>
  );
}
