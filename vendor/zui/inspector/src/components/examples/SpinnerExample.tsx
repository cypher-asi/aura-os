import { Spinner, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function spinnerExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Spinner Sizes</Heading>
        <div style={{ display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="sm" />
            <Text variant="secondary" size="sm" as="span">Small</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="md" />
            <Text variant="secondary" size="sm" as="span">Medium</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Spinner size="lg" />
            <Text variant="secondary" size="sm" as="span">Large</Text>
          </div>
        </div>
      </div>
    </div>
  );
}
