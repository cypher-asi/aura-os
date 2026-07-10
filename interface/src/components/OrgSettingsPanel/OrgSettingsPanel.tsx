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
  User,
  ChevronLeft,
} from "lucide-react";
import { SettingsProfile } from "../SettingsProfile";
import { OrgSettingsGeneral } from "../OrgSettingsGeneral";
import { OrgSettingsMembers } from "../OrgSettingsMembers";
import { OrgSettingsInvites } from "../OrgSettingsInvites";
import { OrgSettingsBilling } from "../OrgSettingsBilling";
import { OrgSettingsRewards } from "../OrgSettingsRewards";
import { OrgSettingsCreditHistory } from "../OrgSettingsCreditHistory/OrgSettingsCreditHistory";
import { OrgSettingsPrivacy } from "../OrgSettingsPrivacy/OrgSettingsPrivacy";
import { AppearanceSection } from "../../views/SettingsView/AppearanceSection";
import {
  THEME_SUB_AREAS,
  DEFAULT_THEME_SUB_AREA,
  groupThemeSubAreas,
  type ThemeSubArea,
} from "../../views/SettingsView/AppearanceSection/themeSubAreas";
import { AboutSection } from "../../views/SettingsView/AboutSection";
import { NotificationsSection } from "../../views/SettingsView/NotificationsSection";
import { KeyboardSection } from "../../views/SettingsView/KeyboardSection";
import { AdvancedSection } from "../../views/SettingsView/AdvancedSection";
import { TierSubscriptionModal } from "../TierSubscriptionModal";
import { useLogout } from "../../stores/use-logout";
import { track } from "../../lib/analytics";
import { useBillingStore } from "../../stores/billing-store";
import { useDeferredModalOpen } from "../../shared/hooks/use-deferred-modal-open";
import { useOrgSettingsData, isOrgSection, type Section } from "./useOrgSettingsData";
import styles from "./OrgSettingsPanel.module.css";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  initialSection?: Section;
  /** Sub-area to open within a drill-down section (e.g. Theme's "background"). */
  initialSubArea?: string;
}

// Personal section — your profile (avatar, name, fields). Shown first.
const YOU_NAV_ITEMS: NavigatorItemProps[] = [
  { id: "you", label: "You", icon: <User size={14} /> },
];

// App-scoped sections — work without an active org.
const APP_NAV_ITEMS: NavigatorItemProps[] = [
  { id: "appearance", label: "Theme", icon: <Paintbrush size={14} /> },
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

// Sections that expand into a second-level drill-down nav. Clicking such a
// section swaps the left column for a "<- Settings > <label>" breadcrumb and a
// sub-area list, and the content pane renders one sub-area at a time. Keyed by
// Section so the capability is generic; only Theme is wired today.
const DRILLDOWN_SECTIONS: Partial<
  Record<Section, { label: string; subAreas: readonly ThemeSubArea[] }>
> = {
  appearance: { label: "Theme", subAreas: THEME_SUB_AREAS },
};

function OrgSectionContent({
  data,
  onUpgrade,
  upgradePreparing,
}: {
  data: ReturnType<typeof useOrgSettingsData>;
  onUpgrade: () => void;
  upgradePreparing: boolean;
}) {
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
        <OrgSettingsRewards onUpgrade={onUpgrade} upgradePreparing={upgradePreparing} />
      )}
      {data.section === "billing" && (
        <OrgSettingsBilling isAdminOrOwner={data.isAdminOrOwner} balance={data.balance} balanceLoading={data.balanceLoading} balanceError={data.balanceError} checkoutError={data.checkoutError} pollingStatus={data.pollingStatus} onPurchase={data.handlePurchase} onRetryBalance={data.loadCreditBalance} onUpgrade={onUpgrade} upgradePreparing={upgradePreparing} />
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

export function OrgSettingsPanel({ isOpen, onClose, initialSection, initialSubArea }: Props) {
  const data = useOrgSettingsData(isOpen, initialSection);
  const logout = useLogout();
  const navigate = useNavigate();
  const [tierModalRequested, setTierModalRequested] = useState(false);
  // When set, the left column shows the section's drill-down sub-nav instead
  // of the top-level groups, and the content pane renders `subAreaId`. Seed
  // from `initialSection` so deep-linking to a drill-down section (e.g.
  // openOrgSettings("appearance")) opens already drilled in.
  const drillFromInitial = (section?: Section): Section | null =>
    section && DRILLDOWN_SECTIONS[section] ? section : null;
  // Resolve the starting sub-area for a drill-down section, honoring an
  // explicit `initialSubArea` deep-link (e.g. Theme > Background) when valid.
  const subAreaFromInitial = (section?: Section, sub?: string): string => {
    const drilled = drillFromInitial(section);
    if (drilled && sub && DRILLDOWN_SECTIONS[drilled]?.subAreas.some((s) => s.id === sub)) {
      return sub;
    }
    return DEFAULT_THEME_SUB_AREA;
  };
  const [drilledSection, setDrilledSection] = useState<Section | null>(() =>
    drillFromInitial(initialSection),
  );
  const [subAreaId, setSubAreaId] = useState<string>(() =>
    subAreaFromInitial(initialSection, initialSubArea),
  );
  const navScrollRef = useRef<HTMLDivElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Re-sync the drill-down state whenever the modal transitions to open (it is
  // usually remounted on open, but this keeps a reopen-without-remount path
  // correct too). Updating state from a prior-prop comparison during render is
  // React's recommended alternative to a setState-in-effect sync.
  const [prevOpen, setPrevOpen] = useState(isOpen);
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) {
      setDrilledSection(drillFromInitial(initialSection));
      setSubAreaId(subAreaFromInitial(initialSection, initialSubArea));
    }
  }

  // Defer opening the tier modal until subscription status is in the
  // billing store, so the modal renders straight to the tier grid at its
  // final size (no "Loading plan details..." shimmer).
  const { isOpen: tierModalOpen, isPreparing: tierPreparing } =
    useDeferredModalOpen({
      requestedOpen: tierModalRequested,
      prepare: () => useBillingStore.getState().fetchSubscription(),
    });

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
    const section = id as Section;
    if (DRILLDOWN_SECTIONS[section]) {
      setDrilledSection(section);
      setSubAreaId(DEFAULT_THEME_SUB_AREA);
    } else {
      setDrilledSection(null);
    }
    data.setSection(section);
  };

  const handleBackToTop = () => setDrilledSection(null);

  const drill = drilledSection ? DRILLDOWN_SECTIONS[drilledSection] : undefined;
  const activeSubArea = drill
    ? (drill.subAreas.find((s) => s.id === subAreaId) ?? drill.subAreas[0])
    : undefined;
  // Break the drill-down sub-nav into labeled groups so it reads as a
  // structured outline (mirrors the You/Team/App grouping above).
  const subGroups = drill ? groupThemeSubAreas(drill.subAreas) : [];

  // App-scoped sections render regardless of org availability so users can
  // always reach Appearance / About / etc. even when no team is loaded.
  const onOrgSection = isOrgSection(data.section);
  const orgUnavailable = !data.activeOrg;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Settings" size="xl" noPadding fullHeight>
      <div className={styles.settingsLayout}>
        <div className={styles.settingsNav}>
          <div ref={navScrollRef} className={styles.settingsNavScroll}>
            {drill ? (
              <>
                <div className={styles.navBreadcrumb}>
                  <button
                    type="button"
                    className={styles.navBackButton}
                    onClick={handleBackToTop}
                  >
                    <ChevronLeft size={14} />
                    <span>Settings</span>
                  </button>
                  <span className={styles.navBreadcrumbSep} aria-hidden="true">
                    ›
                  </span>
                  <span className={styles.navBreadcrumbCurrent}>
                    {drill.label}
                  </span>
                </div>
                {subGroups.map((group) => (
                  <div key={group.group} className={styles.navSubGroup}>
                    <div className={styles.navGroupLabel}>{group.group}</div>
                    <Navigator
                      items={group.items.map((s) => ({
                        id: s.id,
                        label: s.label,
                        icon: <s.icon size={14} />,
                      }))}
                      value={subAreaId}
                      onChange={setSubAreaId}
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className={styles.navHeader}>
                  <h3>{data.activeOrg?.name ?? "Settings"}</h3>
                  <span>{data.activeOrg ? "Team settings" : "App settings"}</span>
                </div>
                <div className={styles.navGroupLabel}>You</div>
                <Navigator items={YOU_NAV_ITEMS} value={data.section} onChange={handleNavChange} />
                <div className={styles.navGroupLabel}>Team</div>
                <Navigator items={ORG_NAV_ITEMS} value={data.section} onChange={handleNavChange} />
                <div className={styles.navGroupLabel}>App</div>
                <Navigator items={APP_NAV_ITEMS} value={data.section} onChange={handleNavChange} />
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
              </>
            )}
          </div>
          <OverlayScrollbar scrollRef={navScrollRef} />
        </div>
        <div className={styles.settingsContent}>
          <div ref={contentScrollRef} className={styles.settingsContentScroll}>
            {activeSubArea ? (
              <activeSubArea.Component />
            ) : data.section === "you" ? (
              <SettingsProfile onClose={onClose} />
            ) : onOrgSection && orgUnavailable ? (
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
              <OrgSectionContent data={data} onUpgrade={() => setTierModalRequested(true)} upgradePreparing={tierPreparing} />
            ) : (
              <AppSectionContent section={data.section} />
            )}
          </div>
          <OverlayScrollbar scrollRef={contentScrollRef} />
        </div>
      </div>
      <TierSubscriptionModal isOpen={tierModalOpen} onClose={() => setTierModalRequested(false)} />
    </Modal>
  );
}
