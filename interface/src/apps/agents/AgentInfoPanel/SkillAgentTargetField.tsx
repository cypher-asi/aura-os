import { Text } from "@cypher-asi/zui";
import { Select } from "../../../components/Select";
import type { Agent } from "../../../shared/types";
import type { SkillAgentTargetBinding } from "../../../shared/api/harness-skills";

interface SkillAgentTargetFieldProps {
  value: string;
  onChange: (agentId: string) => void;
  agents: readonly Agent[];
  selectedSnapshot?: SkillAgentTargetBinding;
}

/**
 * Optional stable collaborator binding for a custom skill.
 *
 * The agent template id is persisted with the skill; the runtime still
 * verifies that the target is attached to the active project before
 * delivering anything. A stale snapshot remains selectable so editing an
 * unrelated instruction never silently drops an existing binding.
 */
export function SkillAgentTargetField({
  value,
  onChange,
  agents,
  selectedSnapshot,
}: SkillAgentTargetFieldProps) {
  const available = [...agents].sort((left, right) =>
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
  );
  const options = [
    { value: "", label: "No direct collaborator" },
    ...available.map((agent) => ({
      value: agent.agent_id,
      label: agent.role ? `${agent.name} — ${agent.role}` : agent.name,
    })),
  ];
  if (
    selectedSnapshot &&
    !available.some((agent) => agent.agent_id === selectedSnapshot.agent_id)
  ) {
    options.push({
      value: selectedSnapshot.agent_id,
      label: `${selectedSnapshot.name} — unavailable`,
    });
  }

  return (
    <div
      data-agent-field="skill-agent-target"
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      <Text size="xs" weight="medium">Collaborating agent</Text>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        ariaLabel="Collaborating agent"
      />
      <Text size="xs" variant="muted">
        Aura will call this agent when the skill instructions delegate work.
        Both agents must be in the current project.
      </Text>
    </div>
  );
}
