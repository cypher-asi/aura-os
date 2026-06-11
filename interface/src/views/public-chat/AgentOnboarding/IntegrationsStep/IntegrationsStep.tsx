import { SelectableCard } from "../SelectableCard";
import type { OnboardingIntegration } from "../onboarding-data";
import styles from "./IntegrationsStep.module.css";

interface IntegrationsStepProps {
  readonly integrations: readonly OnboardingIntegration[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
}

export function IntegrationsStep({
  integrations,
  selected,
  onToggle,
}: IntegrationsStepProps): React.ReactElement {
  const primary = integrations.filter((i) => i.tier === "primary");
  const standard = integrations.filter((i) => i.tier === "standard");

  return (
    <div className={styles.step}>
      <p className={styles.intro}>
        Connect your agent to the data it needs. You can finish connecting these after you sign up.
      </p>

      {primary.length > 0 ? (
        <section className={styles.section} aria-labelledby="integrations-primary">
          <h3 id="integrations-primary" className={styles.sectionTitle}>
            Recommended
          </h3>
          <div className={styles.grid}>
            {primary.map((item) => (
              <SelectableCard
                key={item.id}
                title={item.label}
                description={item.description}
                Icon={item.Icon}
                selected={selected.includes(item.id)}
                onSelect={() => onToggle(item.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {standard.length > 0 ? (
        <section className={styles.section} aria-labelledby="integrations-more">
          <h3 id="integrations-more" className={styles.sectionTitle}>
            More integrations
          </h3>
          <div className={styles.grid}>
            {standard.map((item) => (
              <SelectableCard
                key={item.id}
                title={item.label}
                description={item.description}
                Icon={item.Icon}
                selected={selected.includes(item.id)}
                onSelect={() => onToggle(item.id)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
