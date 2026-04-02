import { useState, useEffect } from "react";
import { Text, Badge } from "@cypher-asi/zui";
import { Zap, Loader2 } from "lucide-react";
import { api } from "../../../api/client";
import { useAgentSidekickStore } from "../stores/agent-sidekick-store";
import type { Agent, HarnessSkill } from "../../../types";
import styles from "./AgentInfoPanel.module.css";

interface SkillsTabProps {
  agent: Agent;
}

export function SkillsTab({ agent }: SkillsTabProps) {
  const [skills, setSkills] = useState<HarnessSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const viewSkill = useAgentSidekickStore((s) => s.viewSkill);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    api.harnessSkills.listSkills()
      .then((data) => {
        if (!cancelled) {
          const skillsList = Array.isArray(data) ? data : (data as any)?.skills ?? [];
          setSkills(skillsList);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className={styles.tabEmptyState}>
        <Loader2 size={16} className={styles.spin} /> Loading skills...
      </div>
    );
  }

  if (error || skills.length === 0) {
    if (agent.skills.length === 0) {
      return <div className={styles.tabEmptyState}>No skills configured</div>;
    }
    return (
      <div className={styles.section}>
        <Text size="xs" variant="muted" weight="medium">Skills</Text>
        <div className={styles.skills}>
          {agent.skills.map((s) => (
            <Badge key={s} variant="pending" className={styles.skillBadge}>{s}</Badge>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <Text size="xs" variant="muted" weight="medium">
        Installed Skills ({skills.length})
      </Text>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
        {skills.map((skill) => (
          <button
            key={skill.name}
            type="button"
            onClick={() => viewSkill(skill)}
            style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              borderRadius: "var(--radius-sm)", border: "none",
              background: "transparent", cursor: "pointer", fontSize: 13,
              color: "var(--color-text)", textAlign: "left", width: "100%",
            }}
            onMouseOver={(e) => { e.currentTarget.style.background = "var(--color-bg-hover, rgba(255,255,255,0.06))"; }}
            onMouseOut={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Zap size={14} style={{ flexShrink: 0, opacity: 0.5 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {skill.name}
              </div>
              {skill.description && (
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {skill.description}
                </div>
              )}
            </div>
            <Badge variant="pending" style={{ fontSize: 10 }}>{skill.source}</Badge>
          </button>
        ))}
      </div>
    </div>
  );
}
