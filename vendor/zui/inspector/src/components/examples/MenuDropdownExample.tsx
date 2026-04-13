import { Button, Heading, MenuDropdown } from '@cypher-asi/zui';
import { MoreVertical } from 'lucide-react';
import styles from './Example.module.css';

export function menudropdownExample() {
  const items = [
    { 
      id: 'edit',
      label: 'Edit', 
      onClick: () => alert('Edit clicked!'),
    },
    { 
      id: 'duplicate',
      label: 'Duplicate', 
      onClick: () => alert('Duplicate clicked!'),
    },
    { 
      id: 'delete',
      label: 'Delete', 
      onClick: () => alert('Delete clicked!'),
      danger: true,
    },
  ];

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Dropdown Menu</Heading>
        <MenuDropdown
          trigger={
            <Button variant="secondary" iconOnly>
              <MoreVertical size={16} />
            </Button>
          }
          items={items}
        />
      </div>
    </div>
  );
}
