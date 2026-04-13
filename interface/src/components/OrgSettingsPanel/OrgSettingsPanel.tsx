import { Button, Modal, Navigator, Text } from "@cypher-asi/zui";
import type { NavigatorItemProps } from "@cypher-asi/zui";
import { Settings, Users, Mail, CreditCard } from "lucide-react";
import { OrgSettingsGeneral } from "../OrgSettingsGeneral";
import { OrgSettingsMembers } from "../OrgSettingsMembers";
import { OrgSettingsInvites } from "../OrgSettingsInvites";
import { OrgSettingsBilling } from "../OrgSettingsBilling";
import { OrgSettingsIntegrations } from "../OrgSettingsIntegrations";
import { useOrgSettingsData } from "./useOrgSettingsData";
import styles from "./OrgSettingsPanel.module.css";

type Section = "general" | "members" | "invites" | "billing" | "integrations";

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
  { id: "integrations", label: "Integrations", icon: <Settings size={14} /> },
];

function OrgSettingsContent({ data }: { data: ReturnType<typeof useOrgSettingsData> }) {
  return (
    <>
      {data.section === "general" && (
        <OrgSettingsGeneral teamName={data.teamName} onTeamNameChange={data.handleTeamNameChange} teamSaving={data.teamSaving} teamMessage={data.teamMessage} />
      )}
      {data.section === "members" && (
        <OrgSettingsMembers members={data.members} myRole={data.myRole} currentUserId={data.user?.user_id} isAdminOrOwner={data.isAdminOrOwner} onRoleChange={data.handleRoleChange} onRemoveMember={data.handleRemoveMember} />
      )}
      {data.section === "invites" && (
        <OrgSettingsInvites invites={data.invites} isAdminOrOwner={data.isAdminOrOwner} onCreateInvite={data.handleCreateInvite} onRevokeInvite={data.handleRevokeInvite} />
      )}
      {data.section === "billing" && (
        <OrgSettingsBilling billing={data.billing} billingEmail={data.billingEmail} onBillingEmailChange={data.setBillingEmail} isAdminOrOwner={data.isAdminOrOwner} saving={data.saving} onSave={data.handleSaveBilling} balance={data.balance} balanceLoading={data.balanceLoading} balanceError={data.balanceError} checkoutError={data.checkoutError} pollingStatus={data.pollingStatus} onPurchase={data.handlePurchase} onRetryBalance={data.loadCreditBalance} />
      )}
      {data.section === "integrations" && (
        <OrgSettingsIntegrations
          integrations={data.integrations}
          busyId={data.integrationBusyId}
          canManage={data.isAdminOrOwner}
          onCreate={data.createIntegration}
          onUpdate={data.updateIntegration}
          onDelete={data.deleteIntegration}
        />
      )}
    </>
  );
}

export function OrgSettingsPanel({ isOpen, onClose, initialSection }: Props) {
  const data = useOrgSettingsData(isOpen, initialSection);

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
          <Navigator items={NAV_ITEMS} value={data.section} onChange={(id) => data.setSection(id as Section)} />
        </div>
        <div className={styles.settingsContent}>
          <OrgSettingsContent data={data} />
        </div>
      </div>
    </Modal>
  );
}
