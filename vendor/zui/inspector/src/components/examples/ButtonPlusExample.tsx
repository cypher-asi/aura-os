import { ButtonPlus, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function buttonplusExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default (Ghost)</Heading>
        <ButtonPlus onClick={() => alert('Add clicked!')} />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Default ghost variant, small size
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Primary Variant</Heading>
        <ButtonPlus
          onClick={() => alert('Add clicked!')}
          variant="primary"
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Primary button style
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Secondary Variant</Heading>
        <ButtonPlus
          onClick={() => alert('Add clicked!')}
          variant="secondary"
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Secondary button style
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Filled Variant</Heading>
        <ButtonPlus
          onClick={() => alert('Add clicked!')}
          variant="filled"
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Accent-colored filled style
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Medium Size</Heading>
        <ButtonPlus
          onClick={() => alert('Add clicked!')}
          size="md"
          iconSize={16}
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Larger button with 16px icon
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Custom Title</Heading>
        <ButtonPlus
          onClick={() => alert('Creating new item!')}
          title="Create new item"
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Hover to see custom tooltip
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled State</Heading>
        <ButtonPlus
          onClick={() => alert('This should not fire!')}
          disabled
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Non-interactive disabled state
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Larger Icon</Heading>
        <ButtonPlus
          onClick={() => alert('Add clicked!')}
          iconSize={20}
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          20px icon in small button
        </Text>
      </div>
    </div>
  );
}
