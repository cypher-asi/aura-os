import { Badge, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function badgeExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Badge Variants</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge variant="running">Running</Badge>
          <Badge variant="stopped">Stopped</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="pending">Pending</Badge>
          <Badge variant="provisioning">Provisioning</Badge>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Pulse Animation</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Badge variant="running" pulse>Running</Badge>
          <Badge variant="provisioning" pulse>Provisioning</Badge>
          <Badge variant="pending" pulse>Pending</Badge>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>In Context</Heading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Text as="span">Status:</Text>
          <Badge variant="running">Active</Badge>
        </div>
      </div>
    </div>
  );
}
