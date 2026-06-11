import { useState } from "react";
import { SelectableCard } from "../SelectableCard";
import type { ExpertiseGroup } from "../onboarding-data";
import styles from "./ExpertiseStep.module.css";

interface ExpertiseStepProps {
  readonly groups: readonly ExpertiseGroup[];
  readonly selectedSkills: readonly string[];
  readonly onToggleSkill: (name: string) => void;
}

/**
 * Skills organized by expertise category. The category rail sits on the left
 * (Popular first) on desktop and collapses to a horizontal chip row on mobile.
 */
export function ExpertiseStep({
  groups,
  selectedSkills,
  onToggleSkill,
}: ExpertiseStepProps): React.ReactElement {
  const [activeGroupId, setActiveGroupId] = useState<string>(groups[0]?.id ?? "");
  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0];

  function selectedCountFor(group: ExpertiseGroup): number {
    return group.skills.reduce((n, s) => (selectedSkills.includes(s.name) ? n + 1 : n), 0);
  }

  return (
    <div className={styles.step}>
      <nav className={styles.rail} aria-label="Skill categories">
        {groups.map((group) => {
          const count = selectedCountFor(group);
          return (
            <button
              key={group.id}
              type="button"
              className={styles.railItem}
              data-active={group.id === activeGroup?.id}
              aria-current={group.id === activeGroup?.id ? "true" : undefined}
              onClick={() => setActiveGroupId(group.id)}
            >
              <span className={styles.railLabel}>{group.label}</span>
              {count > 0 ? <span className={styles.railCount}>{count}</span> : null}
            </button>
          );
        })}
      </nav>

      <div className={styles.skillList} role="list">
        {activeGroup?.skills.map((skill) => (
          <div role="listitem" key={skill.name}>
            <SelectableCard
              title={skill.label}
              description={skill.description}
              Icon={skill.Icon}
              selected={selectedSkills.includes(skill.name)}
              onSelect={() => onToggleSkill(skill.name)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
