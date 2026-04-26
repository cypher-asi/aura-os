import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Badge, Text } from "@cypher-asi/zui";
import { Activity, Bot, ChevronDown, Cloud, KeyRound, Minus, Monitor, Plus, Server, Zap } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { useAuraCapabilities } from "../../hooks/use-aura-capabilities";
import { useProjectAgentState } from "../../apps/chat/components/ChatView/useProjectAgentState";
import { api } from "../../api/client";
import { useRemoteAgentState } from "../../hooks/use-remote-agent-state";
import { projectAgentChatRoute } from "../../utils/mobileNavigation";
import { formatAdapterLabel, formatAuthSourceLabel, formatRunsOnLabel } from "../../apps/agents/AgentInfoPanel/agent-info-utils";
import type { HarnessSkill, HarnessSkillInstallation } from "../../shared/types";
import styles from "./ProjectAgentDetailsView.module.css";

function formatUptime(seconds: number) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  const minutes = Math.floor(seconds / 60) % 60;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ProjectAgentDetailsView() {
  const { projectId, agentInstanceId } = useParams<{ projectId: string; agentInstanceId: string }>();
  const { isMobileLayout } = useAuraCapabilities();
  const { selectedProjectAgent, agentDisplayName, contextUsagePercent } = useProjectAgentState({ projectId, agentInstanceId });
  const { data: remoteState, loading: remoteLoading, error: remoteError } = useRemoteAgentState(
    selectedProjectAgent?.machine_type === "remote" ? selectedProjectAgent.agent_id : undefined,
  );
  const [catalog, setCatalog] = useState<HarnessSkill[]>([]);
  const [installations, setInstallations] = useState<HarnessSkillInstallation[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [showAvailable, setShowAvailable] = useState(false);
  const [showRuntimeDetails, setShowRuntimeDetails] = useState(false);
  const skillsRequestIdRef = useRef(0);

  useEffect(() => {
    if (!selectedProjectAgent?.agent_id) return;
    let cancelled = false;
    const requestId = ++skillsRequestIdRef.current;
    setSkillsLoading(true);
    setSkillsError(null);

    void Promise.allSettled([
      api.harnessSkills.listSkills(),
      api.harnessSkills.listAgentSkills(selectedProjectAgent.agent_id),
    ])
      .then(([catalogResult, installationsResult]) => {
        if (!cancelled && requestId === skillsRequestIdRef.current) {
          const nextCatalog = catalogResult.status === "fulfilled" ? catalogResult.value : [];
          const nextInstallations = installationsResult.status === "fulfilled" ? installationsResult.value : [];
          setCatalog(Array.isArray(nextCatalog) ? nextCatalog : []);
          setInstallations(Array.isArray(nextInstallations) ? nextInstallations : []);
          if (catalogResult.status === "rejected" && installationsResult.status === "rejected") {
            setSkillsError("Skill data is unavailable right now.");
          }
        }
      })
      .catch(() => {
        if (!cancelled && requestId === skillsRequestIdRef.current) {
          setCatalog([]);
          setInstallations([]);
          setSkillsError("Skill data is unavailable right now.");
        }
      })
      .finally(() => {
        if (!cancelled && requestId === skillsRequestIdRef.current) {
          setSkillsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedProjectAgent?.agent_id]);

  const runtimeSummary = useMemo(() => {
    if (!selectedProjectAgent) return null;
    return {
      runsOn: formatRunsOnLabel(selectedProjectAgent.environment, selectedProjectAgent.machine_type),
      adapter: formatAdapterLabel(selectedProjectAgent.adapter_type),
      credentials: formatAuthSourceLabel(selectedProjectAgent.auth_source, selectedProjectAgent.adapter_type),
    };
  }, [selectedProjectAgent]);

  const installedSkillNames = useMemo(
    () => new Set(installations.map((installation) => installation.skill_name)),
    [installations],
  );

  const installedSkills = useMemo(
    () =>
      installations.map((installation) => ({
        installation,
        skill:
          catalog.find((entry) => entry.name === installation.skill_name) ??
          ({
            name: installation.skill_name,
            description: installation.source_url ? "Catalog skill installed on this agent" : "Workspace skill installed on this agent",
            source: installation.source_url ? "catalog" : "workspace",
            model_invocable: false,
            user_invocable: true,
            frontmatter: {},
          } satisfies HarnessSkill),
      })),
    [catalog, installations],
  );

  const availableSkills = useMemo(
    () => catalog.filter((skill) => !installedSkillNames.has(skill.name)),
    [catalog, installedSkillNames],
  );

  async function handleInstallSkill(skillName: string) {
    if (!selectedProjectAgent?.agent_id) return;
    skillsRequestIdRef.current += 1;
    setActionLoading((current) => ({ ...current, [skillName]: true }));
    setSkillsError(null);
    try {
      await api.harnessSkills.installAgentSkill(selectedProjectAgent.agent_id, skillName);
      const skill = catalog.find((entry) => entry.name === skillName);
      const nextInstallation: HarnessSkillInstallation = {
        agent_id: selectedProjectAgent.agent_id,
        skill_name: skillName,
        source_url: skill?.source === "catalog" ? `catalog:${skillName}` : null,
        installed_at: new Date().toISOString(),
        version: null,
        approved_paths: [],
        approved_commands: [],
      };
      setInstallations((current) => [
        ...current.filter((entry) => entry.skill_name !== nextInstallation.skill_name),
        nextInstallation,
      ]);
      setShowAvailable(false);
    } catch {
      setSkillsError("Could not install that skill right now.");
    } finally {
      setActionLoading((current) => ({ ...current, [skillName]: false }));
    }
  }

  async function handleUninstallSkill(skillName: string) {
    if (!selectedProjectAgent?.agent_id) return;
    skillsRequestIdRef.current += 1;
    setActionLoading((current) => ({ ...current, [skillName]: true }));
    setSkillsError(null);
    try {
      await api.harnessSkills.uninstallAgentSkill(selectedProjectAgent.agent_id, skillName);
      setInstallations((current) => current.filter((entry) => entry.skill_name !== skillName));
    } catch {
      setSkillsError("Could not remove that skill right now.");
    } finally {
      setActionLoading((current) => ({ ...current, [skillName]: false }));
    }
  }

  if (!projectId || !agentInstanceId) {
    return null;
  }

  if (!isMobileLayout) {
    return <Navigate to={projectAgentChatRoute(projectId, agentInstanceId)} replace />;
  }

  if (!selectedProjectAgent) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyState}>
          <Text size="sm" weight="medium">Agent settings are still loading</Text>
          <Text size="sm" variant="muted">Return to chat if this agent was removed from the project.</Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.sectionLabel}>Agent Settings</div>
        <div className={styles.agentIdentity}>
          <Avatar avatarUrl={selectedProjectAgent.icon ?? undefined} name={agentDisplayName ?? selectedProjectAgent.name} type="agent" size={52} />
          <div className={styles.agentIdentityCopy}>
            <Text size="lg" weight="medium">{agentDisplayName ?? selectedProjectAgent.name}</Text>
            {selectedProjectAgent.role ? (
              <Text size="sm" variant="muted">{selectedProjectAgent.role}</Text>
            ) : null}
          </div>
          <Badge variant={selectedProjectAgent.machine_type === "remote" ? "running" : "stopped"}>
            {selectedProjectAgent.machine_type === "remote" ? "Remote" : "Local"}
          </Badge>
        </div>
      </header>

      <section className={styles.group}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderCopy}>
            <Text size="sm" weight="medium">Skills</Text>
            <Text size="xs" variant="muted">
              {skillsLoading ? "Loading…" : `${installations.length} installed`}
            </Text>
          </div>
          {!skillsLoading && availableSkills.length > 0 ? (
            <button
              type="button"
              className={styles.sectionToggle}
              onClick={() => setShowAvailable((current) => !current)}
            >
              <ChevronDown size={16} aria-hidden="true" />
              <span>{showAvailable ? "Done" : "Add skills"}</span>
            </button>
          ) : null}
        </div>
        {skillsError ? (
          <Text size="sm" variant="muted">{skillsError}</Text>
        ) : null}
        {skillsLoading ? (
          <Text size="sm" variant="muted">Loading skill setup…</Text>
        ) : installedSkills.length === 0 ? (
          <Text size="sm" variant="muted">This project agent does not have extra skills installed yet.</Text>
        ) : (
          <div className={styles.settingsList}>
            {installedSkills.map(({ installation, skill }) => (
              <div key={installation.skill_name} className={styles.settingRow}>
                <span className={styles.settingIcon}><Zap size={14} aria-hidden="true" /></span>
                <span className={styles.settingCopy}>
                  <span className={styles.skillName}>{skill.name}</span>
                  <span className={styles.skillMeta}>{skill.description || (installation.source_url ? "Catalog skill" : "Workspace skill")}</span>
                </span>
                <button
                  type="button"
                  className={styles.inlineActionButton}
                  onClick={() => handleUninstallSkill(skill.name)}
                  disabled={!!actionLoading[skill.name]}
                  aria-label={`Remove ${skill.name}`}
                >
                  <Minus size={14} aria-hidden="true" />
                  <span>{actionLoading[skill.name] ? "Removing…" : "Remove"}</span>
                </button>
              </div>
            ))}
          </div>
        )}

        {showAvailable ? (
          <div className={styles.availableSection}>
            <Text size="xs" variant="muted" weight="medium">Add skills</Text>
            {availableSkills.length === 0 ? (
              <Text size="sm" variant="muted">No additional skills are ready for this agent yet.</Text>
            ) : (
              <div className={styles.settingsList}>
                {availableSkills.map((skill) => (
                  <div key={skill.name} className={styles.settingRow}>
                    <span className={styles.settingIcon}><Plus size={14} aria-hidden="true" /></span>
                    <span className={styles.settingCopy}>
                      <span className={styles.skillName}>{skill.name}</span>
                      <span className={styles.skillMeta}>{skill.description || "Ready to install on this agent"}</span>
                    </span>
                    <button
                      type="button"
                      className={styles.inlineActionButton}
                      onClick={() => handleInstallSkill(skill.name)}
                      disabled={!!actionLoading[skill.name]}
                      aria-label={`Install ${skill.name}`}
                    >
                      <Plus size={14} aria-hidden="true" />
                      <span>{actionLoading[skill.name] ? "Installing…" : "Install"}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      <section className={styles.group}>
        <div className={styles.cardHeader}>
          <div className={styles.cardHeaderCopy}>
            <Text size="sm" weight="medium">Runtime</Text>
            <Text size="xs" variant="muted">Keep this collapsed unless you need runtime diagnostics.</Text>
          </div>
          <button
            type="button"
            className={styles.sectionToggle}
            onClick={() => setShowRuntimeDetails((current) => !current)}
          >
            <ChevronDown size={16} aria-hidden="true" />
            <span>{showRuntimeDetails ? "Hide runtime" : "Show runtime"}</span>
          </button>
        </div>

        {showRuntimeDetails ? (
          <>
            {contextUsagePercent !== null ? (
              <Text size="xs" variant="muted">{contextUsagePercent}% context used</Text>
            ) : null}
            <div className={styles.settingsList}>
              <div className={styles.metaRow}>
                {selectedProjectAgent.machine_type === "remote" ? <Cloud size={14} aria-hidden="true" /> : <Monitor size={14} aria-hidden="true" />}
                <span className={styles.metaLabel}>Runs on</span>
                <span className={styles.metaValue}>{runtimeSummary?.runsOn}</span>
              </div>
              <div className={styles.metaRow}>
                <Bot size={14} aria-hidden="true" />
                <span className={styles.metaLabel}>Agent type</span>
                <span className={styles.metaValue}>{runtimeSummary?.adapter}</span>
              </div>
              <div className={styles.metaRow}>
                <KeyRound size={14} aria-hidden="true" />
                <span className={styles.metaLabel}>Credentials</span>
                <span className={styles.metaValue}>{runtimeSummary?.credentials}</span>
              </div>
            </div>

            {selectedProjectAgent.machine_type === "remote" ? (
              <div className={styles.subsection}>
                <div className={styles.cardHeaderCopy}>
                  <Text size="sm" weight="medium">Remote runtime</Text>
                  <Text size="xs" variant="muted">Live state from the active remote agent</Text>
                </div>
                {remoteLoading ? (
                  <Text size="sm" variant="muted">Checking remote runtime status…</Text>
                ) : remoteError ? (
                  <Text size="sm" variant="muted">{remoteError}</Text>
                ) : remoteState ? (
                  <div className={styles.settingsList}>
                    <div className={styles.metaRow}>
                      <Server size={14} aria-hidden="true" />
                      <span className={styles.metaLabel}>State</span>
                      <span className={styles.metaValue}>{remoteState.state}</span>
                    </div>
                    <div className={styles.metaRow}>
                      <Activity size={14} aria-hidden="true" />
                      <span className={styles.metaLabel}>Sessions</span>
                      <span className={styles.metaValue}>{remoteState.active_sessions}</span>
                    </div>
                    <div className={styles.metaRow}>
                      <Server size={14} aria-hidden="true" />
                      <span className={styles.metaLabel}>Endpoint</span>
                      <span className={styles.metaValue}>{remoteState.endpoint ?? "Unavailable"}</span>
                    </div>
                    <div className={styles.metaRow}>
                      <Activity size={14} aria-hidden="true" />
                      <span className={styles.metaLabel}>Uptime</span>
                      <span className={styles.metaValue}>{formatUptime(remoteState.uptime_seconds)}</span>
                    </div>
                  </div>
                ) : (
                  <Text size="sm" variant="muted">No remote runtime details available yet.</Text>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
