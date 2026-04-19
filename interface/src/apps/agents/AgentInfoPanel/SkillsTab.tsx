import { useState, useEffect, useCallback } from "react";
import { Text, ButtonMore } from "@cypher-asi/zui";
import { Zap, Loader2, Plus, Trash2, ChevronDown, ChevronRight, FilePlus2, Store } from "lucide-react";
import { api } from "../../../api/client";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { CreateSkillModal } from "./CreateSkillModal";
import { SkillShopModal } from "../../../components/SkillShopModal";
import type { Agent, HarnessSkill, HarnessSkillInstallation } from "../../../types";
import styles from "./SkillsTab.module.css";

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
      </button>
      {installed ? (
        loading ? (
          <div className={styles.skillActionRemove}>
            <Loader2 size={14} className={styles.spin} />
          </div>
        ) : (
          <ButtonMore
            items={[{ id: "uninstall", label: "Uninstall", icon: <Trash2 size={14} /> }]}
            onSelect={() => onAction()}
            icon="horizontal"
            size="sm"
            variant="ghost"
            className={styles.skillMoreBtn}
            title={`Actions for ${skill.name}`}
          />
        )
      ) : (
        <button
          type="button"
          className={styles.skillActionAdd}
          onClick={onAction}
          disabled={loading}
          title={`Install ${skill.name}`}
        >
          {loading ? (
            <Loader2 size={14} className={styles.spin} />
          ) : (
            <Plus size={14} />
          )}
        </button>
      )}
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
  const [fetchError, setFetchError] = useState<string | null>(null);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);
  const installationByName = new Map(installations.map((i) => [i.skill_name, i]));

  const agentId = agent.agent_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [skillsResult, installResult] = await Promise.allSettled([
      api.harnessSkills.listSkills(),
      api.harnessSkills.listAgentSkills(agentId),
    ]);
    if (skillsResult.status === "rejected") {
      console.error("Failed to list skills", skillsResult.reason);
    }
    if (installResult.status === "rejected") {
      console.error("Failed to list agent skills", installResult.reason);
    }
    const skillsData = skillsResult.status === "fulfilled" ? skillsResult.value : [];
    const installData = installResult.status === "fulfilled" ? installResult.value : [];
    const skills = Array.isArray(skillsData) ? skillsData : (skillsData as any)?.skills ?? [];
    const installs = Array.isArray(installData)
      ? installData
      : (installData as any)?.skills ?? (installData as any)?.installations ?? [];
    setCatalog(skills);
    setInstallations(installs);
    setFetchError(
      skillsResult.status === "rejected" && installResult.status === "rejected"
        ? "Failed to load skills. The harness may be unavailable."
        : null,
    );
    setLoading(false);
  }, [agentId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const installedNameSet = new Set(installations.map((i) => i.skill_name));
  const catalogByName = new Map(catalog.map((s) => [s.name, s]));

  // Build installed list from installations, synthesising entries for skills
  // the harness catalog hasn't indexed yet (race after store install).
  const installedSkills: HarnessSkill[] = installations.map((inst) =>
    catalogByName.get(inst.skill_name) ?? {
      name: inst.skill_name,
      description: "",
      source: "store",
      model_invocable: false,
      user_invocable: true,
      frontmatter: {},
    },
  );
  const availableSkills = catalog.filter((s) => !installedNameSet.has(s.name));

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

  return (
    <div className={styles.skillsListWrap}>
      {/* Installed section */}
      <div className={styles.skillsSectionHeader}>
        <Text size="xs" variant="muted" weight="medium">
          Installed{!loading && ` (${installedSkills.length})`}
        </Text>
        <div className={styles.skillHeaderActions}>
          {loading && (
            <div className={styles.skillHeaderSpinner} aria-hidden="true">
              <Loader2 size={12} className={styles.spin} />
            </div>
          )}
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
            title="Skill Shop"
          >
            <Store size={14} />
          </button>
        </div>
      </div>

      {!loading && fetchError && (
        <div className={styles.skillsEmpty} role="alert">
          {fetchError}
        </div>
      )}

      {!loading && !fetchError && (installedSkills.length === 0 ? (
        <div className={styles.skillsEmpty}>No skills installed</div>
      ) : (
        installedSkills.map((skill) => (
          <SkillRow
            key={skill.name}
            skill={skill}
            installed
            loading={!!actionLoading[skill.name]}
            onAction={() => handleUninstall(skill.name)}
            onView={(s) => viewSkill(s, installationByName.get(s.name))}
          />
        ))
      ))}

      {/* Available section (collapsible) */}
      <button
        type="button"
        className={styles.skillsSectionToggle}
        onClick={() => setShowAvailable((v) => !v)}
      >
        {showAvailable ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Text size="xs" variant="muted" weight="medium">
          Available{!loading && ` (${availableSkills.length})`}
        </Text>
      </button>

      {!loading && showAvailable &&
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
        agentId={agentId}
      />

      <SkillShopModal
        isOpen={showStore}
        agentId={agentId}
        initialInstalledNames={installedNameSet}
        onClose={() => setShowStore(false)}
        onInstalled={fetchData}
      />
    </div>
  );
}
