import { GroupCollapsible, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function groupcollapsibleExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Collapsible Sections</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <GroupCollapsible title="Basic Information" defaultOpen={true}>
            <p style={{ color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
              This section contains basic information and is open by default.
            </p>
          </GroupCollapsible>

          <GroupCollapsible title="Advanced Options">
            <p style={{ color: 'var(--color-text-secondary)', margin: '1rem 0' }}>
              This section contains advanced options and is closed by default.
            </p>
          </GroupCollapsible>
        </div>
      </div>
    </div>
  );
}
