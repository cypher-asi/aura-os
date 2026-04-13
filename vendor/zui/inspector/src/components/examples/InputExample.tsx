import { useState } from 'react';
import { Input, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function inputExample() {
  const [value, setValue] = useState('');

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default Input</Heading>
        <Input
          placeholder="Enter text..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Input</Heading>
        <Input
          size="sm"
          placeholder="Small input..."
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Monospace Input</Heading>
        <Input
          mono
          placeholder="api-key-12345..."
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled Input</Heading>
        <Input
          disabled
          placeholder="Disabled..."
        />
      </div>
    </div>
  );
}
