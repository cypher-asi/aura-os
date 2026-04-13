import { Heading, Text, Item } from '@cypher-asi/zui';
import { ComponentInfo } from '../data/componentRegistry';
import { groupDescriptions } from '../data/componentDescriptions';
import styles from './ComponentShowcase.module.css';

export interface GroupInfo {
  id: string;
  name: string;
  components: ComponentInfo[];
}

interface GroupShowcaseProps {
  group: GroupInfo;
  onComponentSelect: (componentId: string) => void;
}

export function GroupShowcase({ group, onComponentSelect }: GroupShowcaseProps) {
  const description = groupDescriptions[group.name.toLowerCase()] 
    ?? `Components related to ${group.name} functionality.`;

  return (
    <div className={styles.showcase}>
      <header className={styles.header}>
        <Text variant="secondary" size="sm" className={styles.category}>Component Group</Text>
        <Heading level={1} className={styles.title}>{group.name}</Heading>
      </header>

      <section className={styles.section}>
        <Heading level={2} className={styles.sectionTitle}>Description</Heading>
        <Text variant="secondary" size="lg" className={styles.description}>{description}</Text>
      </section>

      <section className={styles.section}>
        <Heading level={2} className={styles.sectionTitle}>Components</Heading>
        <Text variant="secondary" className={styles.description} style={{ marginBottom: '1rem' }}>
          This group contains {group.components.length} component{group.components.length !== 1 ? 's' : ''}:
        </Text>
        <div className={styles.exampleContainer}>
          {group.components.map((component) => (
            <Item key={component.id} onClick={() => onComponentSelect(component.id)}>
              <Item.Label>{component.name}</Item.Label>
              <Item.Chevron direction="right" />
            </Item>
          ))}
        </div>
      </section>
    </div>
  );
}
