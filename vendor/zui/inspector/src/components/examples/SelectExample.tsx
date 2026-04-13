import { Select, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function selectExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default Select</Heading>
        <Select>
          <option value="">Select an option...</option>
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
          <option value="3">Option 3</option>
        </Select>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Select</Heading>
        <Select size="sm">
          <option value="">Small select...</option>
          <option value="a">Option A</option>
          <option value="b">Option B</option>
        </Select>
      </div>
    </div>
  );
}
