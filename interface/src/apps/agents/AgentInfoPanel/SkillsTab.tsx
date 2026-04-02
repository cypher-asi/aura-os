import { useState, useEffect, useCallback } from "react";
import { Text, Badge, Button } from "@cypher-asi/zui";
import { Zap, Loader2, AlertTriangle, Plus, X } from "lucide-react";
import { api } from "../../../api/client";
import { useAgentStore } from "../stores";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import { SkillEditorModal } from "./SkillEditorModal";
import type { Agent, HarnessSkill } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

interface SkillsTabProps {
  agent: Agent;
}

export function SkillsTab({ agent }: SkillsTabProps) {
  const [harnessSkills, setHarnessSkills] = useState<HarnessSkill[]>([]);
  const [harnessLoading, setHarnessLoading] = useState(true);
  const [harnessError, setHarnessError] = useState<string | null>(null);
  const [showCreator, setShowCreator] = useState(false);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);

  const fetchHarnessSkills = useCallback(() => {
    setHarnessLoading(true);
    setHarnessError(null);
    api.harnessSkills
      .listSkills()
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as any)?.skills ?? [];
        setHarnessSkills(list);
      })
      .catch((err) => {
        setHarnessError(
          err?.body?.error ?? err?.message ?? "Failed to load skills",
        );
      })
      .finally(() => setHarnessLoading(false));
  }, []);

  useEffect(() => {
    fetchHarnessSkills();
  }, [fetchHarnessSkills]);

  const removeSkillTag = useCallback(
    async (tag: string) => {
      const updated = await api.agents.update(agent.agent_id, {
        skills: agent.skills.filter((s) => s !== tag),
      });
      useAgentStore.getState().patchAgent(updated);
    },
    [agent.agent_id, agent.skills],
  );

  return (
    <div className={styles.skillsTabRoot}>
      {/* Agent skill tags */}
      {agent.skills.length > 0 && (
        <div className={styles.section}>
          <Text size="xs" variant="muted" weight="medium">
            Agent Skills
          </Text>
          <div className={styles.skillTags}>
            {agent.skills.map((tag) => (
              <span key={tag} className={styles.skillTag}>
                {tag}
                <button
                  type="button"
                  className={styles.skillTagRemove}
                  onClick={() => removeSkillTag(tag)}
                  title={`Remove ${tag}`}
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Harness-discovered skills */}
      <div className={styles.section}>
        <div className={styles.skillsSectionHeader}>
          <Text size="xs" variant="muted" weight="medium">
            Harness Skills
          </Text>
          <button
            type="button"
            className={styles.skillsAddBtn}
            onClick={() => setShowCreator(true)}
            title="Create skill"
          >
            <Plus size={12} />
          </button>
        </div>

        {harnessLoading && (
          <div className={styles.skillsInlineStatus}>
            <Loader2 size={12} className={styles.spin} />
            <Text size="xs" variant="muted">Loading...</Text>
          </div>
        )}

        {harnessError && (
          <>
            <div className={styles.skillsError}>
              <AlertTriangle size={14} />
              <Text size="xs" variant="muted">{harnessError}</Text>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchHarnessSkills}>
              Retry
            </Button>
          </>
        )}

        {!harnessLoading && !harnessError && harnessSkills.length === 0 && (
          <Text size="xs" variant="muted">
            No skills yet — click + to create one
          </Text>
        )}

        {!harnessLoading && !harnessError && harnessSkills.length > 0 && (
          <div className={styles.skillsList}>
            {harnessSkills.map((skill) => (
              <button
                key={skill.name}
                type="button"
                className={styles.skillRow}
                onClick={() => viewSkill(skill)}
              >
                <Zap size={14} className={styles.skillRowIcon} />
                <div className={styles.skillRowContent}>
                  <div className={styles.skillRowName}>{skill.name}</div>
                  {skill.description && (
                    <div className={styles.skillRowDesc}>
                      {skill.description}
                    </div>
                  )}
                </div>
                <Badge variant="pending" className={styles.skillSourceBadge}>
                  {skill.source}
                </Badge>
              </button>
            ))}
          </div>
        )}
      </div>

      <SkillEditorModal
        isOpen={showCreator}
        onClose={() => setShowCreator(false)}
        onCreated={fetchHarnessSkills}
      />
    </div>
  );
}
