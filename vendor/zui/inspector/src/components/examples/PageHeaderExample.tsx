import { Button, Heading, PageHeader } from '@cypher-asi/zui';
import { Plus } from 'lucide-react';
import styles from './Example.module.css';

export function pageheaderExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Simple Header</Heading>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
          <PageHeader title="Simple Page" />
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Header with Actions</Heading>
        <div style={{ border: '1px solid var(--color-border)', borderRadius: '8px', overflow: 'hidden' }}>
          <PageHeader
            title="Page with Actions"
            actions={
              <Button size="sm">
                <Plus size={16} />
                Add New
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
