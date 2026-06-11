import { SelectableCard } from "../SelectableCard";
import type { MessagingProvider } from "../onboarding-data";
import styles from "./ConnectionsStep.module.css";

interface ConnectionsStepProps {
  readonly providers: readonly MessagingProvider[];
  readonly selected: readonly string[];
  readonly onToggle: (id: string) => void;
}

/**
 * Messaging providers the agent can be reached through. Only providers with
 * status "available" are selectable; the rest render as disabled "Coming soon"
 * cards.
 */
export function ConnectionsStep({
  providers,
  selected,
  onToggle,
}: ConnectionsStepProps): React.ReactElement {
  return (
    <div className={styles.step}>
      <p className={styles.intro}>
        Chat with your agent from the apps you already use. Telegram is live today — more are on the way.
      </p>
      <div className={styles.grid}>
        {providers.map((provider) => {
          const available = provider.status === "available";
          return (
            <SelectableCard
              key={provider.id}
              title={provider.name}
              description={available ? "Connect after you sign up." : undefined}
              Icon={provider.Icon}
              selected={selected.includes(provider.id)}
              disabled={!available}
              badge={available ? undefined : "Soon"}
              onSelect={() => onToggle(provider.id)}
            />
          );
        })}
      </div>
    </div>
  );
}
