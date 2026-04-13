import { useState } from 'react';
import { Toggle, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function toggleExample() {
  const [enabled, setEnabled] = useState(false);
  const [accentEnabled, setAccentEnabled] = useState(true);

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default Toggle</Heading>
        <div className={styles.toggleContainer}>
          <Toggle
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <Text variant="secondary" as="span">Toggle is {enabled ? 'ON' : 'OFF'}</Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Accent Variant</Heading>
        <div className={styles.toggleContainer}>
          <Toggle
            variant="accent"
            checked={accentEnabled}
            onChange={(e) => setAccentEnabled(e.target.checked)}
          />
          <Text variant="secondary" as="span">Accent variant</Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Toggle</Heading>
        <div className={styles.toggleContainer}>
          <Toggle size="sm" defaultChecked />
          <Text variant="secondary" as="span">Small size</Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Labels</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <Toggle label="Label on right" defaultChecked />
          <Toggle label="Label on left" labelPosition="left" />
        </div>
      </div>
    </div>
  );
}
