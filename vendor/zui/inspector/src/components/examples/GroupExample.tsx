import { Group, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function groupExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Static Sections</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Group title="Basic Information">
            <p style={{ color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
              This section displays content without collapse functionality.
            </p>
          </Group>

          <Group title="Items" count={3}>
            <p style={{ color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
              This section shows a count badge next to the title.
            </p>
          </Group>

          <Group title="Statistics" stats={<span style={{ color: 'var(--color-text-secondary)' }}>24 total</span>}>
            <p style={{ color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
              This section shows stats aligned to the right.
            </p>
          </Group>
        </div>
      </div>
    </div>
  );
}
