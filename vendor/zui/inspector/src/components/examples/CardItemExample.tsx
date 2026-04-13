import { Badge, Button, CardItem, CardItemCode, CardItemMeta, Heading } from '@cypher-asi/zui';
import { MoreVertical } from 'lucide-react';
import styles from './Example.module.css';

export function carditemExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Basic Item Card</Heading>
        <CardItem
          title="Example Item"
          onClick={() => alert('Card clicked!')}
          statusBadge={<Badge variant="running">Active</Badge>}
          meta={
            <>
              <CardItemMeta>Created: 2024-01-15</CardItemMeta>
            </>
          }
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Card with Actions</Heading>
        <CardItem
          title="Item with Menu"
          onClick={() => alert('Card clicked!')}
          actions={
            <Button variant="ghost" iconOnly size="sm">
              <MoreVertical size={16} />
            </Button>
          }
          meta={
            <>
              <CardItemMeta mono>service</CardItemMeta>
              <CardItemMeta>us-east-1</CardItemMeta>
            </>
          }
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Icon Badge and Secondary</Heading>
        <CardItem
          iconBadge="DO"
          title="droplet-prod-01"
          statusBadge={<Badge variant="running" pulse>Running</Badge>}
          meta={
            <>
              <CardItemMeta>4 vCPUs</CardItemMeta>
              <CardItemMeta>8GB RAM</CardItemMeta>
            </>
          }
          secondary={<CardItemCode>192.168.1.100</CardItemCode>}
          badges={
            <>
              <span className={styles.smallBadge}>nyc1</span>
              <span className={styles.smallBadge}>ubuntu</span>
            </>
          }
        />
      </div>
    </div>
  );
}
