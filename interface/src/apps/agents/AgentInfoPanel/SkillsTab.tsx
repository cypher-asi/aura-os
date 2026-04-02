import { useState, useEffect, useCallback } from "react";
import { Text, Badge } from "@cypher-asi/zui";
import { Zap, Loader2, Plus, Minus, ChevronDown, ChevronRight, FilePlus2, Store } from "lucide-react";
import { api } from "../../../api/client";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { CreateSkillModal } from "./CreateSkillModal";
import { SkillStoreModal } from "../../../components/SkillStoreModal";
import type { Agent, HarnessSkill, HarnessSkillInstallation } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

interface SkillsTabProps {
  agent: Agent;
}

interface SkillRowProps {
  skill: HarnessSkill;
  installed: boolean;
  loading: boolean;
  onAction: () => void;
  onView: (skill: HarnessSkill) => void;
}

function SkillRow({ skill, installed, loading, onAction, onView }: SkillRowProps) {
  return (
    <div className={styles.skillRow}>
      <button
        type="button"
        className={styles.skillRowContent}
        onClick={() => onView(skill)}
      >
        <Zap size={14} className={styles.skillRowIcon} />
        <div className={styles.skillRowText}>
          <div className={styles.skillRowName}>{skill.name}</div>
          {skill.description && (
            <div className={styles.skillRowDesc}>{skill.description}</div>
          )}
        </div>
        <Badge variant="pending" className={styles.skillSourceBadge}>
          {skill.source}
        </Badge>
      </button>
      <button
        type="button"
        className={installed ? styles.skillActionRemove : styles.skillActionAdd}
        onClick={onAction}
        disabled={loading}
        title={installed ? `Uninstall ${skill.name}` : `Install ${skill.name}`}
      >
        {loading ? (
          <Loader2 size={14} className={styles.spin} />
        ) : installed ? (
          <Minus size={14} />
        ) : (
          <Plus size={14} />
        )}
      </button>
    </div>
  );
}

export function SkillsTab({ agent }: SkillsTabProps) {
  const [catalog, setCatalog] = useState<HarnessSkill[]>([]);
  const [installations, setInstallations] = useState<HarnessSkillInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [showAvailable, setShowAvailable] = useState(false);
  const [showCreator, setShowCreator] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);

  const agentId = agent.agent_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [skillsData, installData] = await Promise.all([
        api.harnessSkills.listSkills(),
        api.harnessSkills.listAgentSkills(agentId),
      ]);
      const skills = Array.isArray(skillsData) ? skillsData : (skillsData as any)?.skills ?? [];
      const installs = Array.isArray(installData) ? installData : [];
      setCatalog(skills);
      setInstallations(installs);
    } catch {
      setCatalog([]);
      setInstallations([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const installedNames = new Set(installations.map((i) => i.skill_name));
  const installedSkills = catalog.filter((s) => installedNames.has(s.name));
  const availableSkills = catalog.filter((s) => !installedNames.has(s.name));

  const handleInstall = useCallback(
    async (name: string) => {
      setActionLoading((prev) => ({ ...prev, [name]: true }));
      try {
        await api.harnessSkills.installAgentSkill(agentId, name);
        await fetchData();
      } finally {
        setActionLoading((prev) => ({ ...prev, [name]: false }));
      }
    },
    [agentId, fetchData],
  );

  const handleUninstall = useCallback(
    async (name: string) => {
      setActionLoading((prev) => ({ ...prev, [name]: true }));
      try {
        await api.harnessSkills.uninstallAgentSkill(agentId, name);
        await fetchData();
      } finally {
        setActionLoading((prev) => ({ ...prev, [name]: false }));
      }
    },
    [agentId, fetchData],
  );

  if (loading) {
    return (
      <div className={styles.skillsListWrap}>
        <div className={styles.skillsSectionHeader}>
          <Text size="xs" variant="muted" weight="medium">
            <Loader2 size={12} className={styles.spin} /> Loading skills...
          </Text>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.skillsListWrap}>
      {/* Installed section */}
      <div className={styles.skillsSectionHeader}>
        <Text size="xs" variant="muted" weight="medium">
          Installed ({installedSkills.length})
        </Text>
        <div className={styles.skillHeaderActions}>
          <button
            type="button"
            className={styles.skillCreateBtn}
            onClick={() => setShowCreator(true)}
            title="Create skill"
          >
            <FilePlus2 size={14} />
          </button>
          <button
            type="button"
            className={styles.skillCreateBtn}
            onClick={() => setShowStore(true)}
            title="Skill Store"
          >
            <Store size={14} />
          </button>
        </div>
      </div>

      {installedSkills.length === 0 ? (
        <div className={styles.skillsEmpty}>No skills installed</div>
      ) : (
        installedSkills.map((skill) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            installed
            loading={!!actionLoading[skill.name]}
            onAction={() => handleUninstall(skill.name)}
            onView={viewSkill}
          />
        ))
      )}

      {/* Available section (collapsible) */}
      <button
        type="button"
        className={styles.skillsSectionToggle}
        onClick={() => setShowAvailable((v) => !v)}
      >
        {showAvailable ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Text size="xs" variant="muted" weight="medium">
          Available ({availableSkills.length})
        </Text>
      </button>

      {showAvailable &&
        (availableSkills.length === 0 ? (
          <div className={styles.skillsEmpty}>No additional skills available</div>
        ) : (
          availableSkills.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              installed={false}
              loading={!!actionLoading[skill.name]}
              onAction={() => handleInstall(skill.name)}
              onView={viewSkill}
            />
          ))
        ))}

      <CreateSkillModal
        isOpen={showCreator}
        onClose={() => setShowCreator(false)}
        onCreated={fetchData}
      />

      <SkillStoreModal
        isOpen={showStore}
        agentId={agentId}
        onClose={() => setShowStore(false)}
        onInstalled={fetchData}
      />
    </div>
  );
}
