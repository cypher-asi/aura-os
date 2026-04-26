import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { Button, Input, Modal, Text } from "@cypher-asi/zui";
import {
  Activity, Building2, Check,
  ChevronRight, Gem, MessageSquareText, Plus, Server, UserRound,
} from "lucide-react";
import { useFeedStore } from "../../stores/feed-store";
import { useMobileDrawerStore } from "../../stores/mobile-drawer-store";
import { useUIModalStore } from "../../stores/ui-modal-store";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useOrgStore } from "../../stores/org-store";
import { useModalInitialFocus } from "../../hooks/use-modal-initial-focus";
import { getHostDisplayLabel } from "../../shared/lib/host-config";
import styles from "./MobileShell.module.css";

const FeedbackMainPanel = lazy(() =>
  import("../../apps/feedback/FeedbackMainPanel").then((module) => ({ default: module.FeedbackMainPanel })),
);
const FeedMainPanel = lazy(() =>
  import("../../apps/feed/FeedMainPanel").then((module) => ({ default: module.FeedMainPanel })),
);
const ProfileMainPanel = lazy(() =>
  import("../../apps/profile/ProfileMainPanel").then((module) => ({ default: module.ProfileMainPanel })),
);

interface AccountSheetContentProps {
  mode?: "account" | "settings";
  settingsDestination?: SettingsDestination | null;
  onSettingsDestinationChange?: (destination: SettingsDestination | null) => void;
}

export type SettingsDestination = "profile" | "feed" | "leaderboard" | "feedback" | "team" | "host";

export function getSettingsDestinationTitle(destination: SettingsDestination) {
  if (destination === "profile") return "Profile";
  if (destination === "leaderboard") return "Leaderboard";
  if (destination === "feedback") return "Feedback";
  if (destination === "team") return "Team settings";
  if (destination === "host") return "Host settings";
  return "Feed";
}

export function AccountSheetContent({
  mode = "account",
  settingsDestination: controlledSettingsDestination,
  onSettingsDestinationChange,
}: AccountSheetContentProps) {
  const openAfterDrawerClose = useMobileDrawerStore((s) => s.openAfterDrawerClose);
  const closeDrawers = useMobileDrawerStore((s) => s.closeDrawers);
  const { features } = useAuraCapabilities();
  const openOrgSettings = useUIModalStore((s) => s.openOrgSettings);
  const openHostSettings = useUIModalStore((s) => s.openHostSettings);
  const setFeedFilter = useFeedStore((s) => s.setFilter);
  const { inputRef, initialFocusRef, autoFocus } = useModalInitialFocus<HTMLInputElement>();
  const orgs = useOrgStore((s) => s.orgs);
  const activeOrg = useOrgStore((s) => s.activeOrg);
  const switchOrg = useOrgStore((s) => s.switchOrg);
  const createOrg = useOrgStore((s) => s.createOrg);
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [uncontrolledSettingsDestination, setUncontrolledSettingsDestination] = useState<SettingsDestination | null>(null);
  const lastOrgSelectionRef = useRef<{ orgId: string | null; atMs: number }>({
    orgId: null,
    atMs: 0,
  });
  const isSettingsDestinationControlled = onSettingsDestinationChange !== undefined;
  const settingsDestination = isSettingsDestinationControlled
    ? controlledSettingsDestination ?? null
    : uncontrolledSettingsDestination;

  const setSettingsDestination = useCallback((destination: SettingsDestination | null) => {
    if (onSettingsDestinationChange) {
      onSettingsDestinationChange(destination);
      return;
    }
    setUncontrolledSettingsDestination(destination);
  }, [onSettingsDestinationChange]);

  const handleOrgSelection = useCallback((orgId: string) => {
    const now = Date.now();
    if (
      lastOrgSelectionRef.current.orgId === orgId &&
      now - lastOrgSelectionRef.current.atMs < 400
    ) {
      return;
    }

    lastOrgSelectionRef.current = { orgId, atMs: now };
    switchOrg(orgId);
    closeDrawers();
  }, [closeDrawers, switchOrg]);

  async function handleCreateOrg() {
    const trimmed = teamName.trim();
    if (!trimmed) return;

    setCreating(true);
    setCreateError(null);
    try {
      const created = await createOrg(trimmed);
      switchOrg(created.org_id);
      setCreateOpen(false);
      setTeamName("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create a team right now.");
    } finally {
      setCreating(false);
    }
  }

  const openSettingsDestination = useCallback((destination: SettingsDestination) => {
    if (destination === "feed") {
      setFeedFilter("everything");
    }
    if (destination === "leaderboard") {
      setFeedFilter("leaderboard");
    }
    setSettingsDestination(destination);
  }, [setFeedFilter]);

  const openLeaderboard = useCallback(() => {
    openSettingsDestination("leaderboard");
  }, [openSettingsDestination]);

  const isSettingsMode = mode === "settings";

  return (
    <>
      <div className={styles.mobileDrawerContent}>
        <div className={styles.mobileDrawerBody}>
          {isSettingsMode && settingsDestination ? (
            <section className={styles.mobileSettingsDetail} aria-labelledby="mobile-settings-detail-title">
              <span id="mobile-settings-detail-title" className={styles.mobileSettingsDetailTitleHidden}>
                {getSettingsDestinationTitle(settingsDestination)}
              </span>
              <div className={styles.mobileSettingsDetailContent}>
                {settingsDestination === "profile" ? (
                  <div className={styles.mobileSettingsEmbeddedPanel}>
                    <Suspense fallback={<Text size="sm" variant="muted">Loading profile...</Text>}>
                      <ProfileMainPanel />
                    </Suspense>
                  </div>
                ) : settingsDestination === "feed" || settingsDestination === "leaderboard" ? (
                  <div className={styles.mobileSettingsEmbeddedPanel}>
                    <Suspense fallback={<Text size="sm" variant="muted">Loading feed...</Text>}>
                      <FeedMainPanel />
                    </Suspense>
                  </div>
                ) : settingsDestination === "feedback" ? (
                  <div className={styles.mobileSettingsEmbeddedPanel}>
                    <Suspense fallback={<Text size="sm" variant="muted">Loading feedback...</Text>}>
                      <FeedbackMainPanel />
                    </Suspense>
                  </div>
                ) : settingsDestination === "team" ? (
                  <div className={styles.mobileSettingsDetailCard}>
                    <div className={styles.mobileSettingsDetailCardTitle}>{activeOrg?.name ?? "No team selected"}</div>
                    <div className={styles.mobileSettingsDetailCardMeta}>
                      Manage members, invites, billing, and integrations without losing your current project context.
                    </div>
                    <Button variant="primary" onClick={openOrgSettings}>Open Team Settings</Button>
                  </div>
                ) : (
                  <div className={styles.mobileSettingsDetailCard}>
                    <div className={styles.mobileSettingsDetailCardTitle}>Current target</div>
                    <div className={styles.mobileSettingsDetailMono}>{getHostDisplayLabel()}</div>
                    <div className={styles.mobileSettingsDetailCardMeta}>
                      Host settings open as a focused modal, then return here when closed.
                    </div>
                    <Button variant="primary" onClick={openHostSettings}>Open Host Settings</Button>
                  </div>
                )}
              </div>
            </section>
          ) : isSettingsMode ? (
            <section className={styles.mobileSettingsPanel} aria-labelledby="mobile-settings-title">
              <div className={styles.mobileSettingsHero}>
                <div>
                  <div className={styles.mobileDrawerSectionEyebrow}>
                    <Building2 size={15} />
                    <span id="mobile-settings-title">Current team</span>
                  </div>
                  <div className={styles.mobileSettingsTeamName}>{activeOrg?.name ?? "No team selected"}</div>
                </div>
                <div className={styles.mobileDrawerSectionDescription}>
                  Account, team, activity, and community views live here so project navigation can stay focused.
                </div>
              </div>

              <div className={styles.mobileSettingsShortcutGrid} aria-label="Settings destinations">
                <button type="button" className={styles.mobileSettingsShortcut} onClick={() => openSettingsDestination("profile")}>
                  <span className={styles.mobileSettingsShortcutIcon}><UserRound size={18} /></span>
                  <span>
                    <span className={styles.mobileSettingsShortcutTitle}>Profile</span>
                    <span className={styles.mobileSettingsShortcutMeta}>Account summary</span>
                  </span>
                </button>
                <button type="button" className={styles.mobileSettingsShortcut} onClick={() => openSettingsDestination("feed")}>
                  <span className={styles.mobileSettingsShortcutIcon}><Activity size={18} /></span>
                  <span>
                    <span className={styles.mobileSettingsShortcutTitle}>Feed</span>
                    <span className={styles.mobileSettingsShortcutMeta}>Team activity</span>
                  </span>
                </button>
                <button type="button" className={styles.mobileSettingsShortcut} onClick={openLeaderboard}>
                  <span className={styles.mobileSettingsShortcutIcon}><Gem size={18} /></span>
                  <span>
                    <span className={styles.mobileSettingsShortcutTitle}>Leaderboard</span>
                    <span className={styles.mobileSettingsShortcutMeta}>Rankings</span>
                  </span>
                </button>
                <button type="button" className={styles.mobileSettingsShortcut} onClick={() => openSettingsDestination("feedback")}>
                  <span className={styles.mobileSettingsShortcutIcon}><MessageSquareText size={18} /></span>
                  <span>
                    <span className={styles.mobileSettingsShortcutTitle}>Feedback</span>
                    <span className={styles.mobileSettingsShortcutMeta}>Ideas and votes</span>
                  </span>
                </button>
              </div>
            </section>
          ) : (
            <section className={styles.mobileDrawerSectionBlock} aria-labelledby="mobile-team-switcher-title">
              <div className={styles.mobileDrawerSectionHeaderRow}>
                <div className={styles.mobileDrawerSectionEyebrow}>
                  <Building2 size={15} />
                  <span id="mobile-team-switcher-title">Organization</span>
                </div>
                <span className={styles.mobileDrawerSectionMeta}>
                  {activeOrg?.name ?? "No team selected"}
                </span>
              </div>
              <div className={styles.mobileDrawerSectionDescription}>
                Feed, leaderboard, projects, and integrations follow the active organization.
              </div>
              {orgs.length > 0 ? (
                <div className={styles.mobileOrgList} role="list" aria-label="Organizations">
                  {orgs.map((org) => {
                    const isActive = org.org_id === activeOrg?.org_id;
                    return (
                      <button
                        key={org.org_id}
                        type="button"
                        role="listitem"
                        className={`${styles.mobileOrgButton} ${isActive ? styles.mobileOrgButtonActive : ""}`}
                        aria-pressed={isActive}
                        onPointerUp={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          handleOrgSelection(org.org_id);
                        }}
                        onClick={() => handleOrgSelection(org.org_id)}
                      >
                        <span className={styles.mobileOrgButtonText}>
                          <span className={styles.mobileOrgButtonName}>{org.name}</span>
                          {isActive ? (
                            <span className={styles.mobileOrgButtonMeta}>
                              Current organization
                            </span>
                          ) : null}
                        </span>
                        <span className={styles.mobileOrgButtonIcon}>
                          {isActive ? <Check size={16} /> : <ChevronRight size={16} />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.mobileDrawerEmptyState}>
                  <Text variant="muted" size="sm">
                    Create your first team to unlock projects, agents, and mobile workspaces.
                  </Text>
                </div>
              )}
            </section>
          )}
          {isSettingsMode ? (
            <div className={styles.mobileSettingsActionList} aria-label="Team settings actions">
              <button type="button" className={styles.mobileSettingsAction} onClick={() => setCreateOpen(true)}>
                <Plus size={16} />
                <span>{orgs.length === 0 ? "Create Team" : "New Team"}</span>
              </button>
              <button type="button" className={styles.mobileSettingsAction} onClick={() => openSettingsDestination("team")}>
                <Building2 size={16} />
                <span>Team settings</span>
              </button>
              {features.hostRetargeting ? (
                <button type="button" className={styles.mobileSettingsAction} onClick={() => openSettingsDestination("host")}>
                  <Server size={16} />
                  <span>Host settings</span>
                </button>
              ) : null}
            </div>
          ) : (
            <div className={styles.mobileDrawerActions}>
              <Button
                variant={orgs.length === 0 ? "primary" : "ghost"}
                size="sm"
                icon={<Plus size={16} />}
                className={styles.mobileDrawerAction}
                onClick={() => setCreateOpen(true)}
              >
                {orgs.length === 0 ? "Create Team" : "New Team"}
              </Button>
              <Button variant="ghost" size="sm" icon={<Building2 size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openOrgSettings)}>Team settings</Button>
              {features.hostRetargeting ? (
                <Button variant="ghost" size="sm" icon={<Server size={16} />} className={styles.mobileDrawerAction} onClick={() => openAfterDrawerClose(openHostSettings)}>Host settings</Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
      <Modal
        isOpen={createOpen}
        onClose={() => {
          if (creating) return;
          setCreateOpen(false);
          setCreateError(null);
        }}
        title="Create Team"
        size="sm"
        initialFocusRef={initialFocusRef}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button variant="primary" onClick={handleCreateOrg} disabled={creating || !teamName.trim()}>
              {creating ? "Creating..." : "Create Team"}
            </Button>
          </>
        )}
      >
        <div className={styles.mobileCreateOrgModal}>
          <Text variant="muted" size="sm">
            Teams keep projects, agents, and mobile activity grouped under one active organization.
          </Text>
          <Input
            ref={inputRef}
            autoFocus={autoFocus}
            value={teamName}
            onChange={(event) => {
              setTeamName(event.target.value);
              setCreateError(null);
            }}
            placeholder="Team name"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleCreateOrg();
              }
            }}
          />
          {createError ? <Text variant="muted" size="sm">{createError}</Text> : null}
        </div>
      </Modal>
    </>
  );
}

export function PreviewSheetContent({ PreviewPanel, PreviewHeader }: { PreviewPanel: React.ComponentType; PreviewHeader?: React.ComponentType }) {
  return (
    <div className={styles.mobileDrawerContent}>
      {PreviewHeader && <div className={styles.mobileContextHeader}><PreviewHeader /></div>}
      <div
        className={`${styles.mobileDrawerBody} ${styles.mobilePreviewDrawerBody}`}
        data-testid="preview-drawer-body"
      >
        <PreviewPanel />
      </div>
    </div>
  );
}
