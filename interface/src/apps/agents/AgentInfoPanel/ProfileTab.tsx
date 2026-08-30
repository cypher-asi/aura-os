import { useState, useEffect, useMemo } from "react";
import { Text, Badge } from "@cypher-asi/zui";
import {
  Bot,
  Calendar,
  Monitor,
  Cloud,
  KeyRound,
  Zap,
  Server,
  Clock3,
  Activity,
  AlertTriangle,
  Wallet,
} from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { api } from "../../../api/client";
import { useRemoteAgentState } from "../../../hooks/use-remote-agent-state";
import { useCardTilt } from "./use-card-tilt";
import { ProfileCard3D, type ProfileSectionLink } from "./ProfileCard3D";
import { ProfileSpecCard } from "./ProfileSpecCard";
import { ProfileChannelBar } from "./ProfileChannelBar";
import { isWebGLAvailable } from "./profile-card-scene";
import {
  formatAdapterLabel,
  formatAuthSourceLabel,
  formatRunsOnLabel,
} from "./agent-info-utils";
import type { Agent, HarnessSkill, HarnessSkillInstallation } from "../../../shared/types";
import { isSuperAgent } from "../../../shared/types/permissions";
import { TelegramConnectView, useTelegramLink } from "../components/TelegramConnect";
import styles from "./AgentInfoPanel.module.css";

export interface ProfileTabProps {
  agent: Agent;
  isOwnAgent: boolean;
  isMobileStandalone?: boolean;
  onViewSkill?: (skill: HarnessSkill, installation?: HarnessSkillInstallation) => void;
}

/**
 * Some `listAgentSkills` callers receive a bare array, others receive an
 * envelope `{ skills: [...] }` or `{ installations: [...] }`. Narrow the
 * envelope shape and pull whichever array is present.
 */
function extractInstallations(value: unknown): HarnessSkillInstallation[] {
  if (typeof value !== "object" || value === null) return [];
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.skills)) return obj.skills as HarnessSkillInstallation[];
  if (Array.isArray(obj.installations)) return obj.installations as HarnessSkillInstallation[];
  return [];
}

/** Shorten an on-chain address for display, e.g. `0x9469…412f`. */
function truncateAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60) % 60;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function MobileRemoteRuntimeSection({ agent }: { agent: Agent }) {
  const { data, loading, error } = useRemoteAgentState(agent.machine_type === "remote" ? agent.agent_id : undefined);

  if (agent.machine_type !== "remote") {
    return null;
  }

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">Remote Runtime</Text>
      {loading ? (
        <Text size="sm" variant="muted">Checking remote agent status…</Text>
      ) : error ? (
        <div className={`${styles.mobileStatusCard} ${styles.mobileStatusWarning}`}>
          <div className={styles.mobileStatusHeader}>
            <Server size={14} className={styles.mobileStatusIcon} />
            <Text size="sm" weight="medium">Remote agent unavailable</Text>
          </div>
          <Text size="sm" variant="muted">{error}</Text>
        </div>
      ) : data ? (
        <div className={styles.mobileStatusCard}>
          <div className={styles.mobileStatusHeader}>
            <Server size={14} className={styles.mobileStatusIcon} />
            <Text size="sm" weight="medium">Remote agent is {data.state}</Text>
          </div>
          <div className={styles.mobileStatusGrid}>
            <div className={styles.mobileStatusRow}>
              <Clock3 size={12} className={styles.mobileStatusRowIcon} />
              <span className={styles.mobileStatusLabel}>Uptime</span>
              <span className={styles.mobileStatusValue}>{formatUptime(data.uptime_seconds)}</span>
            </div>
            <div className={styles.mobileStatusRow}>
              <Activity size={12} className={styles.mobileStatusRowIcon} />
              <span className={styles.mobileStatusLabel}>Sessions</span>
              <span className={styles.mobileStatusValue}>{data.active_sessions}</span>
            </div>
            {data.endpoint ? (
              <div className={styles.mobileStatusRow}>
                <Server size={12} className={styles.mobileStatusRowIcon} />
                <span className={styles.mobileStatusLabel}>Endpoint</span>
                <span className={styles.mobileStatusValue}>{data.endpoint}</span>
              </div>
            ) : null}
            {data.runtime_version ? (
              <div className={styles.mobileStatusRow}>
                <Bot size={12} className={styles.mobileStatusRowIcon} />
                <span className={styles.mobileStatusLabel}>Runtime</span>
                <span className={styles.mobileStatusValue}>{data.runtime_version}</span>
              </div>
            ) : null}
          </div>
          {data.error_message ? (
            <div className={`${styles.mobileStatusMessage} ${styles.mobileStatusWarning}`}>
              <AlertTriangle size={12} className={styles.mobileStatusRowIcon} />
              <Text size="xs" variant="muted">{data.error_message}</Text>
            </div>
          ) : null}
        </div>
      ) : (
        <Text size="sm" variant="muted">No remote runtime details available yet.</Text>
      )}
    </div>
  );
}

function MobileSkillsSection({
  installations,
  onViewSkill,
}: {
  installations: HarnessSkillInstallation[];
  onViewSkill?: (skill: HarnessSkill, installation?: HarnessSkillInstallation) => void;
}) {
  const installableSkills = useMemo(
    () => installations.map((installation) => ({
      installation,
      skill: {
        name: installation.skill_name,
        description: "Installed on this agent",
        source: installation.source_url ? "catalog" : "workspace",
        model_invocable: false,
        user_invocable: false,
        frontmatter: {},
      } satisfies HarnessSkill,
    })),
    [installations],
  );

  return (
    <div className={styles.section}>
      <div className={styles.mobileSectionHeader}>
        <Text size="xs" variant="muted" weight="medium">Installed Skills</Text>
        <Text size="xs" variant="muted">{installations.length}</Text>
      </div>
      {installableSkills.length === 0 ? (
        <Text size="sm" variant="muted">No skills installed on this agent yet.</Text>
      ) : (
        <div className={styles.mobileSkillList}>
          {installableSkills.map(({ skill, installation }) => (
            <button
              key={skill.name}
              type="button"
              className={styles.mobileSkillButton}
              onClick={() => onViewSkill?.(skill, installation)}
            >
              <span className={styles.mobileSkillButtonMain}>
                <Zap size={14} className={styles.mobileSkillIcon} />
                <span className={styles.mobileSkillText}>
                  <span className={styles.mobileSkillName}>{skill.name}</span>
                  <span className={styles.mobileSkillMeta}>
                    {installation.source_url ? "Catalog skill" : "Workspace skill"}
                  </span>
                </span>
              </span>
              <span className={styles.mobileSkillAction}>View</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileCardMedia({ agent }: { agent: Agent }) {
  const [broken, setBroken] = useState(false);
  const showCover = !!agent.icon && !broken;

  if (showCover) {
    return (
      <div className={styles.cardMedia}>
        <img
          src={agent.icon!}
          alt={agent.name}
          className={styles.cardMediaImage}
          onError={() => setBroken(true)}
        />
      </div>
    );
  }

  return (
    <div className={`${styles.cardMedia} ${styles.cardMediaFallback}`}>
      <Avatar avatarUrl={undefined} name={agent.name} type="agent" size={80} />
    </div>
  );
}

function ProfileCard({
  agent,
  isOwnAgent,
}: Pick<ProfileTabProps, "agent" | "isOwnAgent">) {
  const cardRef = useCardTilt<HTMLDivElement>();

  return (
    <div className={styles.cardContainer}>
      <div ref={cardRef} className={styles.card}>
        <span className={styles.cardShine} aria-hidden="true" />
        <div className={styles.cardInner}>
          <ProfileCardMedia agent={agent} />

          <div className={styles.cardBody}>
            <div className={styles.cardHeader}>
              <div className={styles.nameText}>
                <span className={styles.displayName}>{agent.name}</span>
                {agent.role && <span className={styles.subtitle}>{agent.role}</span>}
              </div>
              {!isOwnAgent && (
                <div className={styles.nameAction}>
                  <FollowEditButton isOwner={false} targetProfileId={agent.profile_id} />
                </div>
              )}
            </div>

            {isSuperAgent(agent) && (
              <div className={styles.cardBadgeRow}>
                <Badge variant="running">CEO SuperAgent</Badge>
              </div>
            )}

            <ProfileMetaGrid agent={agent} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileMetaGrid({ agent }: { agent: Agent }) {
  return (
    <div className={styles.metaGrid}>
      <div className={styles.metaRow}>
        {agent.machine_type === "remote" ? (
          <Cloud size={13} className={styles.metaIcon} />
        ) : (
          <Monitor size={13} className={styles.metaIcon} />
        )}
        <div className={styles.metaText}>
          <span className={styles.metaLabel}>Runs On</span>
          <span className={styles.metaValue}>
            {formatRunsOnLabel(agent.environment, agent.machine_type)}
          </span>
        </div>
      </div>
      <div className={styles.metaRow}>
        <Bot size={13} className={styles.metaIcon} />
        <div className={styles.metaText}>
          <span className={styles.metaLabel}>Agent Type</span>
          <span className={styles.metaValue}>{formatAdapterLabel(agent.adapter_type)}</span>
        </div>
      </div>
      <div className={styles.metaRow}>
        <KeyRound size={13} className={styles.metaIcon} />
        <div className={styles.metaText}>
          <span className={styles.metaLabel}>Credentials</span>
          <span className={styles.metaValue}>
            {formatAuthSourceLabel(agent.auth_source, agent.adapter_type)}
          </span>
        </div>
      </div>
      {agent.wallet_address && (
        <div className={styles.metaRow}>
          <Wallet size={13} className={styles.metaIcon} />
          <div className={styles.metaText}>
            <span className={styles.metaLabel}>Wallet</span>
            <span className={styles.metaValue} title={agent.wallet_address}>
              {truncateAddress(agent.wallet_address)}
            </span>
          </div>
        </div>
      )}
      <div className={styles.metaRow}>
        <Calendar size={13} className={styles.metaIcon} />
        <div className={styles.metaText}>
          <span className={styles.metaLabel}>Birthed</span>
          <span className={styles.metaValue}>
            {new Date(agent.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ProfileTab(props: ProfileTabProps) {
  const { agent } = props;
  const [installations, setInstallations] = useState<HarnessSkillInstallation[]>([]);
  const [connectorCount, setConnectorCount] = useState(0);
  const webglOk = useMemo(() => isWebGLAvailable(), []);
  // One Telegram link controller shared by the channel-bar Telegram icon and
  // the pop-over panel below it, so clicking the icon drives the connect flow
  // and the QR/status renders in the dismissible pop-over.
  const telegram = useTelegramLink({ agent });
  const [telegramOpen, setTelegramOpen] = useState(false);

  const handleTelegramClick = () => {
    setTelegramOpen(true);
    // Mirror the old Connect button: kick off a fresh link unless already
    // connected (where the pop-over just shows the connected/disconnect state).
    if (!telegram.isConnected) {
      void telegram.startLink();
    }
  };

  useEffect(() => {
    let cancelled = false;
    api.harnessSkills
      .listAgentSkills(agent.agent_id)
      .then((result: unknown) => {
        if (cancelled) return;
        const list: HarnessSkillInstallation[] = Array.isArray(result)
          ? (result as HarnessSkillInstallation[])
          : extractInstallations(result);
        setInstallations(list);
      })
      .catch(() => {
        if (!cancelled) setInstallations([]);
      });
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  // Connectors count (connected channels) - only meaningful for remote agents.
  // Non-remote agents are treated as 0 in the memo below.
  useEffect(() => {
    if (agent.machine_type !== "remote") return;
    let cancelled = false;
    api.channels
      .listChannels(agent.agent_id)
      .then((res) => {
        if (!cancelled) {
          setConnectorCount(res.channels.filter((c) => c.status === "connected").length);
        }
      })
      .catch(() => {
        if (!cancelled) setConnectorCount(0);
      });
    return () => { cancelled = true; };
  }, [agent.agent_id, agent.machine_type]);

  const sections = useMemo<ProfileSectionLink[]>(
    () => [
      { id: "skills", label: "Skills", count: installations.length },
      {
        id: "messaging",
        label: "Connectors",
        count: agent.machine_type === "remote" ? connectorCount : 0,
      },
      {
        id: "permissions",
        label: "Permissions",
        count: agent.permissions?.capabilities?.length ?? 0,
      },
    ],
    [agent.permissions, agent.machine_type, installations.length, connectorCount],
  );

  return (
    <>
      {webglOk ? (
        <>
          <ProfileCard3D agent={agent} isOwnAgent={props.isOwnAgent} />
          {telegram.isRemote && (
            <ProfileChannelBar
              onTelegramClick={handleTelegramClick}
              telegramDisabled={telegram.linking}
              telegramConnected={telegram.isConnected}
            />
          )}
          {telegram.isRemote && telegramOpen && (
            <TelegramConnectView
              controller={telegram}
              compact
              onClose={() => setTelegramOpen(false)}
            />
          )}
          <ProfileSpecCard agent={agent} sections={sections} />
        </>
      ) : (
        <ProfileCard agent={agent} isOwnAgent={props.isOwnAgent} />
      )}
      {props.isMobileStandalone && <MobileRemoteRuntimeSection agent={agent} />}
      {props.isMobileStandalone && (
        <MobileSkillsSection
          installations={installations}
          onViewSkill={props.onViewSkill}
        />
      )}
    </>
  );
}
