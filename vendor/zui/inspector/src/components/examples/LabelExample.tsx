import { Label, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function labelExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Label Variants</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label variant="default">Default</Label>
          <Label variant="success">Running</Label>
          <Label variant="warning">Blocked</Label>
          <Label variant="danger">Zombie</Label>
          <Label variant="info">Pending</Label>
          <Label variant="muted">Draft</Label>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Label Sizes</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label size="xs">Extra Small</Label>
          <Label size="sm">Small (Default)</Label>
          <Label size="md">Medium</Label>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Text Transforms</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label uppercase>Uppercase (default)</Label>
          <Label uppercase={false}>Mixed Case</Label>
          <Label mono>Monospace</Label>
          <Label mono uppercase={false}>Mono Mixed</Label>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Border</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label border variant="default">Default</Label>
          <Label border variant="success">Running</Label>
          <Label border variant="warning">Blocked</Label>
          <Label border variant="danger">Zombie</Label>
          <Label border variant="info">Pending</Label>
          <Label border variant="muted">Draft</Label>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Process States</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label variant="success" size="xs">Running</Label>
          <Label variant="warning" size="xs">Blocked</Label>
          <Label variant="danger" size="xs">Zombie</Label>
          <Label variant="info" size="xs">Pending</Label>
          <Label variant="muted" size="xs">Stopped</Label>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>In Context</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Text as="span" size="sm">Process Status:</Text>
            <Label variant="success" size="xs">Running</Label>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Text as="span" size="sm">Type:</Text>
            <Label variant="info" size="xs">Service</Label>
            <Label variant="muted" size="xs">Background</Label>
          </div>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Accessibility</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <Label variant="success" role="status" aria-label="Process is running">
            Running
          </Label>
          <Label variant="danger" as="div" role="alert">
            Critical
          </Label>
        </div>
      </div>
    </div>
  );
}
