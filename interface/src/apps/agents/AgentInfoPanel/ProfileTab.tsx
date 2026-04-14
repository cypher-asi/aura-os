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
} from "lucide-react";
import { Avatar } from "../../../components/Avatar";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { api } from "../../../api/client";
import { useRemoteAgentState } from "../../../hooks/use-remote-agent-state";
import {
  formatAdapterLabel,
  formatAuthSourceLabel,
  formatRunsOnLabel,
} from "./agent-info-utils";
import type { Agent, HarnessSkill, HarnessSkillInstallation } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

export interface ProfileTabProps {
  agent: Agent;
  isOwnAgent: boolean;
  isMobileStandalone?: boolean;
  onViewSkill?: (skill: HarnessSkill, installation?: HarnessSkillInstallation) => void;
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

function ProfileImage({ agent }: { agent: Agent }) {
  const [broken, setBroken] = useState(false);
  const showCover = !!agent.icon && !broken;

  if (showCover) {
    return (
      <div className={styles.profileCover}>
        <img
          src={agent.icon!}
          alt={agent.name}
          className={styles.profileCoverImage}
          onError={() => setBroken(true)}
        />
      </div>
    );
  }

  return (
    <div className={styles.profileImageBlock}>
      <Avatar avatarUrl={undefined} name={agent.name} type="agent" size={80} />
    </div>
  );
}

function ProfileHeader({
  agent,
  isOwnAgent,
}: Pick<ProfileTabProps, "agent" | "isOwnAgent">) {
  return (
    <>
      <ProfileImage agent={agent} />

      <div className={styles.nameBlock}>
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

      {agent.tags?.includes("super_agent") && (
        <div className={styles.section}>
          <Badge variant="running">CEO SuperAgent</Badge>
        </div>
      )}

      {agent.personality && (
        <div className={styles.section}>
          <Text size="xs" variant="muted" weight="medium">Personality</Text>
          <Text size="sm">{agent.personality}</Text>
        </div>
      )}
    </>
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

  useEffect(() => {
    let cancelled = false;
    api.harnessSkills
      .listAgentSkills(agent.agent_id)
      .then((result) => {
        if (cancelled) return;
        const list = Array.isArray(result)
          ? result
          : (result as any)?.skills ?? (result as any)?.installations ?? [];
        setInstallations(list);
      })
      .catch(() => {
        if (!cancelled) setInstallations([]);
      });
    return () => { cancelled = true; };
  }, [agent.agent_id]);

  return (
    <>
      <ProfileHeader
        agent={agent}
        isOwnAgent={props.isOwnAgent}
      />
      <ProfileMetaGrid agent={agent} />
      {props.isMobileStandalone && <MobileRemoteRuntimeSection agent={agent} />}
      {props.isMobileStandalone && (
        <MobileSkillsSection
          installations={installations}
          onViewSkill={props.onViewSkill}
        />
      )}
      {installations.length > 0 && (
        <div className={styles.skillTagsSection}>
          {installations.map((inst) => (
            <span key={inst.skill_name} className={styles.skillTag}>
              <Zap size={10} className={styles.skillTagIcon} />
              {inst.skill_name}
            </span>
          ))}
        </div>
      )}
      {agent.system_prompt && (
        <div className={styles.section}>
          <Text size="xs" variant="muted" weight="medium">System Prompt</Text>
          <Text size="sm" className={styles.prompt}>{agent.system_prompt}</Text>
        </div>
      )}
    </>
  );
}
