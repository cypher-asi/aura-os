import { SelectableCard } from "../SelectableCard";
import type { AutomationPreset } from "../onboarding-data";
import styles from "./AutomationsStep.module.css";

interface AutomationsStepProps {
  readonly automations: readonly AutomationPreset[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
}

export function AutomationsStep({
  automations,
  selected,
  onToggle,
}: AutomationsStepProps): React.ReactElement {
  return (
    <div className={styles.step}>
      <p className={styles.intro}>
        Pick the routines your agent should run for you. We'll set these up once your agent is live.
      </p>
      <div className={styles.grid}>
        {automations.map((automation) => (
          <SelectableCard
            key={automation.id}
            title={automation.name}
            description={automation.description}
            Icon={automation.Icon}
            selected={selected.includes(automation.id)}
            onSelect={() => onToggle(automation.id)}
          />
        ))}
      </div>
    </div>
  );
}
