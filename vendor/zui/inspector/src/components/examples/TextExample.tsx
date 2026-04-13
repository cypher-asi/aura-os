import { Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function textExample() {
  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Text Sizes</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Text size="2xs">2XS text - smallest for fine print</Text>
          <Text size="xs">Extra small text - perfect for captions and metadata</Text>
          <Text size="sm">Small text - good for secondary information</Text>
          <Text size="base">Base text - the default size for body content</Text>
          <Text size="lg">Large text - for emphasis or introductory content</Text>
          <Text size="xl">Extra large text - for important messages or headers</Text>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Font Weights</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Text weight="normal">Normal weight text</Text>
          <Text weight="medium">Medium weight text</Text>
          <Text weight="semibold">Semibold weight text</Text>
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Text Variants</Heading>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Text variant="primary">Primary text (default)</Text>
          <Text variant="secondary">Secondary text</Text>
          <Text variant="muted">Muted text</Text>
        </div>
      </div>
    </div>
  );
}
