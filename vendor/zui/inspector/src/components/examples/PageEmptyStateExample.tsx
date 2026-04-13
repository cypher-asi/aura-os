import { Button, Heading, PageEmptyState } from '@cypher-asi/zui';
import { Plus, Inbox } from 'lucide-react';
import styles from './Example.module.css';

export function pageemptystateExample() {
  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>Empty State with Action</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        overflow: 'hidden',
        minHeight: '300px',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <PageEmptyState
          icon={<Plus size={48} />}
          title="No items yet"
          description="Get started by creating your first item"
          actions={
            <Button onClick={() => alert('Create clicked!')}>
              <Plus size={16} />
              Create Item
            </Button>
          }
        />
      </div>

      <Heading level={3} className={styles.exampleTitle} style={{ marginTop: 'var(--space-6)' }}>Empty State without Action</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        overflow: 'hidden',
        minHeight: '300px',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <PageEmptyState
          icon={<Inbox size={48} />}
          title="No results found"
          description="There are no items matching your criteria"
        />
      </div>
    </div>
  );
}
