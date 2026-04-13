import { Textarea, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function textareaExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default Textarea</Heading>
        <Textarea
          placeholder="Enter description..."
          rows={4}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Textarea</Heading>
        <Textarea
          size="sm"
          placeholder="Small textarea..."
          rows={3}
        />
      </div>
    </div>
  );
}
