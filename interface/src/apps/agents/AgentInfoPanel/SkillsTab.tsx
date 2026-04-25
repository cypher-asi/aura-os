import { useState, useEffect, useCallback } from "react";
import { Text, Button, ButtonMore, Modal } from "@cypher-asi/zui";
import { Zap, Loader2, Plus, Trash2, ChevronDown, ChevronRight, FilePlus2, Store } from "lucide-react";
import { api } from "../../../api/client";
import type { MySkillEntry, SkillInstalledAgentRef } from "../../../api/harness-skills";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { CreateSkillModal } from "./CreateSkillModal";
import { SkillShopModal } from "../../../components/SkillShopModal";
import type { Agent, HarnessSkill, HarnessSkillInstallation } from "../../../types";
import styles from "./SkillsTab.module.css";

interface SkillsTabProps {
  agent: Agent;
}

/**
 * Some harness endpoints return either a bare array or an envelope object
 * such as `{ skills: [...] }` / `{ installations: [...] }`. This helper
 * narrows an `unknown` payload to the first matching array field, returning
 * `[]` when no shape matches. Caller asserts the element type.
 */
function extractArrayField<T>(value: unknown, fields: readonly string[]): T[] {
  if (typeof value !== "object" || value === null) return [];
  const obj = value as Record<string, unknown>;
  for (const f of fields) {
    const v = obj[f];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
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

interface DeleteSkillConfirmModalProps {
  isOpen: boolean;
  skillName: string;
  deleting: boolean;
  error: string | null;
  /** Populated when the server rejects the delete because the skill is
   *  still installed on one or more agents. Drives the inline "uninstall
   *  from these agents first" hint so the user knows exactly what to do. */
  blockingAgents: SkillInstalledAgentRef[];
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteSkillConfirmModal({
  isOpen,
  skillName,
  deleting,
  error,
  blockingAgents,
  onClose,
  onConfirm,
}: DeleteSkillConfirmModalProps) {
  const blocked = blockingAgents.length > 0;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Delete skill"
      size="sm"
      footer={
        <div className={styles.deleteConfirmFooter}>
          <Button variant="ghost" onClick={onClose} disabled={deleting}>
            {blocked ? "Close" : "Cancel"}
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={deleting || blocked}
          >
            {deleting ? (
              <>
                <Loader2 size={14} className={styles.spin} /> Deleting...
              </>
            ) : (
              "Delete"
            )}
          </Button>
        </div>
      }
    >
      <Text size="sm">
        Delete the skill <strong>{skillName}</strong>? This permanently removes{" "}
        <code>~/.aura/skills/{skillName}/</code> and cannot be undone. Uninstall
        this skill from every agent first — delete is blocked while any agent
        still has it.
      </Text>
      {blocked && (
        <div className={styles.deleteConfirmError} role="alert">
          <Text size="xs" weight="medium">
            Still installed on:
          </Text>
          <ul>
            {blockingAgents.map((a) => (
              <li key={a.agent_id}>{a.name || a.agent_id}</li>
            ))}
          </ul>
        </div>
      )}
      {!blocked && error && (
        <Text size="xs" className={styles.deleteConfirmError}>
          {error}
        </Text>
      )}
    </Modal>
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
  // Name of the skill the user has clicked "Delete skill" on; drives the
  // confirmation modal. `null` = modal closed.
  const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Populated from a 409 response body when the server refuses to delete
  // because the skill is still installed elsewhere. The modal renders these
  // inline so the user knows exactly which agents to clean up first.
  const [blockingAgents, setBlockingAgents] = useState<SkillInstalledAgentRef[]>([]);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);
  const installationByName = new Map(installations.map((i) => [i.skill_name, i]));

  const agentId = agent.agent_id;

  /**
   * Re-fetch catalog + installations + user-authored skills.
   *
   * `silent` keeps the existing rows on screen while the refetch runs
   * — use it after a mutation (install / uninstall / delete / create)
   * so the sidekick's three collapsible sections don't flash empty
   * ("Loading...") on every click. The initial load omits `silent`
   * so the first render still shows a loading state.
   */
  const fetchData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
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
    const skillsData: unknown = skillsResult.status === "fulfilled" ? skillsResult.value : [];
    const installData: unknown = installResult.status === "fulfilled" ? installResult.value : [];
    const mineData: unknown = mineResult.status === "fulfilled" ? mineResult.value : [];

    const skills: HarnessSkill[] = Array.isArray(skillsData)
      ? (skillsData as HarnessSkill[])
      : extractArrayField<HarnessSkill>(skillsData, ["skills"]);
    const installs: HarnessSkillInstallation[] = Array.isArray(installData)
      ? (installData as HarnessSkillInstallation[])
      : extractArrayField<HarnessSkillInstallation>(installData, ["skills", "installations"]);
    const mine: MySkillEntry[] = Array.isArray(mineData) ? (mineData as MySkillEntry[]) : [];
    setCatalog(skills);
    setInstallations(installs);
    setMySkills(mine);
    setFetchError(
      skillsResult.status === "rejected" && installResult.status === "rejected"
        ? "Failed to load skills. The harness may be unavailable."
        : null,
    );
    if (!silent) setLoading(false);
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
        await fetchData({ silent: true });
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
        await fetchData({ silent: true });
      } finally {
        setActionLoading((prev) => ({ ...prev, [name]: false }));
      }
    },
    [agentId, fetchData],
  );

  const requestDeleteMySkill = useCallback((name: string) => {
    setDeleteError(null);
    setBlockingAgents([]);
    setPendingDeleteName(name);
  }, []);

  const closeDeleteConfirm = useCallback(() => {
    // Don't let the user dismiss the modal mid-delete — the in-flight
    // request would still complete and leave the UI in a half-state.
    if (pendingDeleteName && actionLoading[pendingDeleteName]) return;
    setPendingDeleteName(null);
    setDeleteError(null);
    setBlockingAgents([]);
  }, [pendingDeleteName, actionLoading]);

  const confirmDeleteMySkill = useCallback(async () => {
    const name = pendingDeleteName;
    if (!name) return;

    setDeleteError(null);
    setBlockingAgents([]);
    setActionLoading((prev) => ({ ...prev, [name]: true }));
    try {
      // No pre-emptive uninstall here. The server is the source of truth for
      // "still installed anywhere?" — hiding the real state by quietly
      // uninstalling from the current agent first was exactly how the
      // original cascade bug slipped through (other agents kept their
      // installation records pointing at a SKILL.md that had been deleted).
      await api.harnessSkills.deleteMySkill(name);

      // Optimistically drop the skill from all three local lists so the
      // row vanishes in place instead of waiting for the refetch round-trip.
      setMySkills((prev) => prev.filter((s) => s.name !== name));
      setInstallations((prev) => prev.filter((i) => i.skill_name !== name));
      setCatalog((prev) => prev.filter((s) => s.name !== name));

      setPendingDeleteName(null);
      void fetchData({ silent: true });
    } catch (err) {
      console.error(`Failed to delete skill ${name}`, err);
      const body = (err as {
        body?: {
          error?: string;
          message?: string;
          agents?: SkillInstalledAgentRef[];
        };
      })?.body;
      if (body?.error === "installed_on_agents" && Array.isArray(body.agents)) {
        setBlockingAgents(body.agents);
        // Keep the modal open; the inline blocker list replaces the
        // generic error string in this case.
        setDeleteError(null);
      } else {
        const msg =
          body?.message ??
          body?.error ??
          (err as { message?: string })?.message ??
          "Failed to delete skill. Please try again.";
        setDeleteError(msg);
      }
    } finally {
      setActionLoading((prev) => ({ ...prev, [name]: false }));
    }
  }, [pendingDeleteName, fetchData]);

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
                onDelete={() => requestDeleteMySkill(skill.name)}
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
        onCreated={() => fetchData({ silent: true })}
        agentId={agentId}
      />

      <SkillShopModal
        isOpen={showStore}
        agentId={agentId}
        initialInstalledNames={installedNameSet}
        onClose={() => setShowStore(false)}
        onInstalled={() => fetchData({ silent: true })}
      />

      <DeleteSkillConfirmModal
        isOpen={pendingDeleteName !== null}
        skillName={pendingDeleteName ?? ""}
        deleting={pendingDeleteName ? !!actionLoading[pendingDeleteName] : false}
        error={deleteError}
        blockingAgents={blockingAgents}
        onClose={closeDeleteConfirm}
        onConfirm={confirmDeleteMySkill}
      />
    </div>
  );
}
