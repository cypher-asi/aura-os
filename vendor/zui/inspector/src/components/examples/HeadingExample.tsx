import { Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function headingExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Heading Levels</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <Heading level={1}>Heading Level 1</Heading>
          <Heading level={2}>Heading Level 2</Heading>
          <Heading level={3}>Heading Level 3</Heading>
          <Heading level={4}>Heading Level 4</Heading>
          <Heading level={5}>Heading Level 5</Heading>
          <Heading level={6}>Heading Level 6</Heading>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Usage Examples</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <Heading level={1}>Page Title</Heading>
            <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
              Main page heading - use sparingly, typically once per page
            </Text>
          </div>
          <div>
            <Heading level={2}>Section Heading</Heading>
            <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
              For major sections within a page
            </Text>
          </div>
          <div>
            <Heading level={3}>Subsection Heading</Heading>
            <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
              For subsections and content groups
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
}
