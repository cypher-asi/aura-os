import { useState, useEffect } from "react";
import { Text, Badge, Button } from "@cypher-asi/zui";
import {
  Bot,
  Calendar,
  Monitor,
  Cloud,
  KeyRound,
  Zap,
} from "lucide-react";
import { FollowEditButton } from "../../../components/FollowEditButton";
import { api } from "../../../api/client";
import {
  formatAdapterLabel,
  formatAuthSourceLabel,
  formatRunsOnLabel,
  type RuntimeReadiness,
} from "./agent-info-utils";
import type { Agent, HarnessSkillInstallation } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

export interface ProfileTabProps {
  agent: Agent;
  imageUrl: string | undefined;
  isOwnAgent: boolean;
  onIconError: () => void;
  runtimeTesting: boolean;
  runtimeTestMessage: string | null;
  runtimeTestDetails: string | null;
  runtimeTestStatus: "success" | "error" | null;
  onRuntimeTest: () => void;
  runtimeResultRef: React.RefObject<HTMLDivElement | null>;
  runtimeReadiness: RuntimeReadiness;
}

function ProfileHeader({
  agent,
  imageUrl,
  isOwnAgent,
  onIconError,
}: Pick<ProfileTabProps, "agent" | "imageUrl" | "isOwnAgent" | "onIconError">) {
  return (
    <>
      {imageUrl ? (
        <div className={styles.profileImageBlock}>
          <img src={imageUrl} alt={agent.name} className={styles.profileImage} onError={onIconError} />
        </div>
      ) : (
        <div className={styles.profileAvatarBlock}>
          <span className={styles.profileInitial}>
            {agent.name.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

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
        <span className={styles.metaValue}>
          {formatRunsOnLabel(agent.environment, agent.machine_type)}
        </span>
      </div>
      <div className={styles.metaRow}>
        <Bot size={13} className={styles.metaIcon} />
        <span className={styles.metaValue}>{formatAdapterLabel(agent.adapter_type)}</span>
      </div>
      <div className={styles.metaRow}>
        <KeyRound size={13} className={styles.metaIcon} />
        <span className={styles.metaValue}>
          {formatAuthSourceLabel(agent.auth_source)}
          {agent.integration_id ? " \u2022 team integration attached" : ""}
        </span>
      </div>
      <div className={styles.metaRow}>
        <Calendar size={13} className={styles.metaIcon} />
        <span className={styles.metaValue}>
          Birthed {new Date(agent.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
        </span>
      </div>
    </div>
  );
}

function RuntimeSection({
  agent,
  runtimeReadiness,
  runtimeTesting,
  runtimeTestMessage,
  runtimeTestDetails,
  runtimeTestStatus,
  onRuntimeTest,
  runtimeResultRef,
}: {
  agent: Agent;
  runtimeReadiness: RuntimeReadiness;
  runtimeTesting: boolean;
  runtimeTestMessage: string | null;
  runtimeTestDetails: string | null;
  runtimeTestStatus: "success" | "error" | null;
  onRuntimeTest: () => void;
  runtimeResultRef: React.RefObject<HTMLDivElement | null>;
}) {
  const readinessClass =
    runtimeReadiness.tone === "success"
      ? styles.runtimeReadinessSuccess
      : runtimeReadiness.tone === "warning"
        ? styles.runtimeReadinessWarning
        : styles.runtimeReadinessInfo;

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">Runtime</Text>
      <Text size="sm">
        {formatAdapterLabel(agent.adapter_type)} &bull; Runs On:{" "}
        {formatRunsOnLabel(agent.environment, agent.machine_type)} &bull; Authentication:{" "}
        {formatAuthSourceLabel(agent.auth_source)}
      </Text>
      <div className={`${styles.runtimeReadiness} ${readinessClass}`}>
        <Text size="xs" weight="medium" className={styles.runtimeReadinessTitle}>
          {runtimeReadiness.title}
        </Text>
        <Text size="xs" variant="muted">{runtimeReadiness.message}</Text>
      </div>
      <div className={styles.nameAction} style={{ marginTop: 8 }}>
        <Button variant="secondary" size="sm" onClick={onRuntimeTest} disabled={runtimeTesting}>
          {runtimeTesting ? "Checking..." : "Check Runtime"}
        </Button>
      </div>
      {runtimeTestMessage && (
        <RuntimeTestResult
          runtimeResultRef={runtimeResultRef}
          runtimeTestStatus={runtimeTestStatus}
          runtimeTestMessage={runtimeTestMessage}
          runtimeTestDetails={runtimeTestDetails}
        />
      )}
    </div>
  );
}

function RuntimeTestResult({
  runtimeResultRef,
  runtimeTestStatus,
  runtimeTestMessage,
  runtimeTestDetails,
}: {
  runtimeResultRef: React.RefObject<HTMLDivElement | null>;
  runtimeTestStatus: "success" | "error" | null;
  runtimeTestMessage: string;
  runtimeTestDetails: string | null;
}) {
  return (
    <div
      ref={runtimeResultRef}
      className={`${styles.runtimeTestResult} ${
        runtimeTestStatus === "error" ? styles.runtimeTestError : styles.runtimeTestSuccess
      }`}
      aria-live="polite"
    >
      <Text size="xs" weight="medium" className={styles.runtimeTestTitle}>
        {runtimeTestStatus === "error" ? "Runtime check failed" : "Runtime ready"}
      </Text>
      <Text size="xs" variant="muted">{runtimeTestMessage}</Text>
      {runtimeTestDetails && (
        <Text size="xs" variant="muted" className={styles.runtimeTestMeta}>
          {runtimeTestDetails}
        </Text>
      )}
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
        imageUrl={props.imageUrl}
        isOwnAgent={props.isOwnAgent}
        onIconError={props.onIconError}
      />
      <ProfileMetaGrid agent={agent} />
      <RuntimeSection
        agent={agent}
        runtimeReadiness={props.runtimeReadiness}
        runtimeTesting={props.runtimeTesting}
        runtimeTestMessage={props.runtimeTestMessage}
        runtimeTestDetails={props.runtimeTestDetails}
        runtimeTestStatus={props.runtimeTestStatus}
        onRuntimeTest={props.onRuntimeTest}
        runtimeResultRef={props.runtimeResultRef}
      />
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
