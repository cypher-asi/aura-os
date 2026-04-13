import { useState } from 'react';
import { Button, Heading, Text } from '@cypher-asi/zui';
import { TerminalSquare, Download, Settings } from 'lucide-react';
import styles from './Example.module.css';

export function buttonExample() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSelected, setIsSelected] = useState(false);

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Primary Button</Heading>
        <Button variant="primary" onClick={() => alert('Primary clicked!')}>
          Primary Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Secondary Button</Heading>
        <Button variant="secondary" onClick={() => alert('Secondary clicked!')}>
          Secondary Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Ghost Button</Heading>
        <Button variant="ghost" onClick={() => alert('Ghost clicked!')}>
          Ghost Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Danger Button</Heading>
        <Button variant="danger" onClick={() => alert('Danger clicked!')}>
          Delete
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Filled Button</Heading>
        <Button variant="filled" onClick={() => alert('Filled clicked!')}>
          Filled Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Glass Button</Heading>
        <Button variant="glass" onClick={() => alert('Glass clicked!')}>
          Glass Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Transparent Button</Heading>
        <Button variant="transparent" onClick={() => alert('Transparent clicked!')}>
          Transparent Button
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Size</Heading>
        <Button size="sm">Small Button</Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Icon</Heading>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button icon={<TerminalSquare size={14} />}>Terminal</Button>
          <Button variant="glass" size="sm" icon={<Download size={12} />}>Download</Button>
          <Button variant="secondary" icon={<Settings size={14} />}>Settings</Button>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled</Heading>
        <Button disabled>Disabled Button</Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Selected State</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Toggle button with selected state for tabs, menus, etc.
        </Text>
        <Button 
          variant="transparent"
          size="sm"
          selected={isSelected}
          onClick={() => setIsSelected(!isSelected)}
        >
          {isSelected ? 'Selected' : 'Click to Select'}
        </Button>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Stable Size (No Jerk)</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Button maintains consistent size across text changes
        </Text>
        <Button 
          size="sm"
          onClick={() => setIsLoading(!isLoading)}
          contentStates={['Save Changes', 'Saving...']}
        >
          {isLoading ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
