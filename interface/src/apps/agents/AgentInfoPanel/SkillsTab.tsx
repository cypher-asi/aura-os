import { useState, useEffect, useCallback } from "react";
import { Text, ButtonMore } from "@cypher-asi/zui";
import { Zap, Loader2, Plus, Trash2, ChevronDown, ChevronRight, FilePlus2, Store } from "lucide-react";
import { api } from "../../../api/client";
import type { MySkillEntry } from "../../../api/harness-skills";
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
  /** When provided, the row shows a "Delete skill" action in its menu.
   *  Only passed for user-authored ("My Skills") rows — deleting
   *  removes the SKILL.md file and is a different operation from
   *  uninstalling the skill from the current agent. */
  onDelete?: () => void;
}

function SkillRow({
  skill,
  installed,
  loading,
  onAction,
  onView,
  onDelete,
}: SkillRowProps) {
  const menuItems: Array<
    { id: string; label: string; icon?: React.ReactNode } | { type: "separator" }
  > = [];
  if (installed) {
    menuItems.push({ id: "uninstall", label: "Uninstall", icon: <Trash2 size={14} /> });
  } else if (onDelete) {
    menuItems.push({ id: "install", label: "Install", icon: <Plus size={14} /> });
  }
  if (onDelete) {
    if (menuItems.length > 0) {
      menuItems.push({ type: "separator" });
    }
    menuItems.push({ id: "delete", label: "Delete skill", icon: <Trash2 size={14} /> });
  }

  const handleSelect = (id: string) => {
    if (id === "delete") {
      onDelete?.();
    } else {
      onAction();
    }
  };

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
      {loading ? (
        <div className={styles.skillActionRemove}>
          <Loader2 size={14} className={styles.spin} />
        </div>
      ) : installed || onDelete ? (
        <ButtonMore
          items={menuItems}
          onSelect={handleSelect}
          icon="horizontal"
          size="sm"
          variant="ghost"
          className={styles.skillMoreBtn}
          title={`Actions for ${skill.name}`}
        />
      ) : (
        <button
          type="button"
          className={styles.skillActionAdd}
          onClick={onAction}
          title={`Install ${skill.name}`}
        >
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}

export function SkillsTab({ agent }: SkillsTabProps) {
  const [catalog, setCatalog] = useState<HarnessSkill[]>([]);
  const [installations, setInstallations] = useState<HarnessSkillInstallation[]>([]);
  const [mySkills, setMySkills] = useState<MySkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [showAvailable, setShowAvailable] = useState(false);
  const [showMine, setShowMine] = useState(true);
  const [showCreator, setShowCreator] = useState(false);
  const [showStore, setShowStore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);
  const installationByName = new Map(installations.map((i) => [i.skill_name, i]));

  const agentId = agent.agent_id;

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [skillsResult, installResult, mineResult] = await Promise.allSettled([
      api.harnessSkills.listSkills(),
      api.harnessSkills.listAgentSkills(agentId),
      api.harnessSkills.listMySkills(),
    ]);
    if (skillsResult.status === "rejected") {
      console.error("Failed to list skills", skillsResult.reason);
    }
    if (installResult.status === "rejected") {
      console.error("Failed to list agent skills", installResult.reason);
    }
    if (mineResult.status === "rejected") {
      console.error("Failed to list user-created skills", mineResult.reason);
    }
    const skillsData = skillsResult.status === "fulfilled" ? skillsResult.value : [];
    const installData = installResult.status === "fulfilled" ? installResult.value : [];
    const mineData = mineResult.status === "fulfilled" ? mineResult.value : [];
    const skills = Array.isArray(skillsData) ? skillsData : (skillsData as any)?.skills ?? [];
    const installs = Array.isArray(installData)
      ? installData
      : (installData as any)?.skills ?? (installData as any)?.installations ?? [];
    const mine = Array.isArray(mineData) ? mineData : [];
    setCatalog(skills);
    setInstallations(installs);
    setMySkills(mine);
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
  const mySkillNameSet = new Set(mySkills.map((s) => s.name));

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

  // "My Skills" lists everything the user authored via the Create Skill flow,
  // independent of install state on this agent. Rows still carry the correct
  // install/uninstall affordance based on the current agent's installations.
  const mySkillsRows: HarnessSkill[] = mySkills.map((m) => ({
    name: m.name,
    description: m.description,
    source: "user-created",
    model_invocable: m.model_invocable,
    user_invocable: m.user_invocable,
    frontmatter: {},
  }));

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

  const handleDeleteMySkill = useCallback(
    async (name: string) => {
      const ok = window.confirm(
        `Delete the skill "${name}"?\n\nThis permanently removes ~/.aura/skills/${name}/ and cannot be undone. Any agent that has this skill installed will lose it.`,
      );
      if (!ok) return;

      setActionLoading((prev) => ({ ...prev, [name]: true }));
      try {
        // Uninstall from the current agent first so its installation
        // record doesn't outlive the underlying SKILL.md file and
        // render as a ghost row on next fetch.
        if (installedNameSet.has(name)) {
          try {
            await api.harnessSkills.uninstallAgentSkill(agentId, name);
          } catch (err) {
            console.error(`Failed to uninstall ${name} from agent before delete`, err);
          }
        }
        await api.harnessSkills.deleteMySkill(name);
        await fetchData();
      } catch (err) {
        console.error(`Failed to delete skill ${name}`, err);
        alert(
          `Failed to delete skill "${name}". See console for details.`,
        );
      } finally {
        setActionLoading((prev) => ({ ...prev, [name]: false }));
      }
    },
    [agentId, installedNameSet, fetchData],
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

      {/* My Skills section (collapsible) — skills the current user authored */}
      <button
        type="button"
        className={styles.skillsSectionToggle}
        onClick={() => setShowMine((v) => !v)}
      >
        {showMine ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Text size="xs" variant="muted" weight="medium">
          My Skills{!loading && ` (${mySkillsRows.length})`}
        </Text>
      </button>

      {!loading && !fetchError && showMine &&
        (mySkillsRows.length === 0 ? (
          <div className={styles.skillsEmpty}>
            No skills yet — click the + above to create one
          </div>
        ) : (
          mySkillsRows.map((skill) => {
            const installed = installedNameSet.has(skill.name);
            return (
              <SkillRow
                key={`mine-${skill.name}`}
                skill={skill}
                installed={installed}
                loading={!!actionLoading[skill.name]}
                onAction={() =>
                  installed ? handleUninstall(skill.name) : handleInstall(skill.name)
                }
                onView={(s) => viewSkill(s, installationByName.get(s.name))}
                onDelete={() => handleDeleteMySkill(skill.name)}
              />
            );
          })
        ))}

      {/* Available section (collapsible). Excludes skills shown under
          "My Skills" so a single user-authored skill doesn't appear twice. */}
      <button
        type="button"
        className={styles.skillsSectionToggle}
        onClick={() => setShowAvailable((v) => !v)}
      >
        {showAvailable ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Text size="xs" variant="muted" weight="medium">
          Available
          {!loading &&
            ` (${availableSkills.filter((s) => !mySkillNameSet.has(s.name)).length})`}
        </Text>
      </button>

      {!loading && showAvailable &&
        (() => {
          const rows = availableSkills.filter((s) => !mySkillNameSet.has(s.name));
          return rows.length === 0 ? (
            <div className={styles.skillsEmpty}>No additional skills available</div>
          ) : (
            rows.map((skill) => (
              <SkillRow
                key={skill.name}
                skill={skill}
                installed={false}
                loading={!!actionLoading[skill.name]}
                onAction={() => handleInstall(skill.name)}
                onView={viewSkill}
              />
            ))
          );
        })()}

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
