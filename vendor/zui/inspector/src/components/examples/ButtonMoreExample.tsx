import { ButtonMore, Heading, Text } from '@cypher-asi/zui';
import { Edit, Copy, Trash2, Download, Share2 } from 'lucide-react';
import styles from './Example.module.css';

export function buttonmoreExample() {
  const basicItems = [
    { id: 'edit', label: 'Edit' },
    { id: 'duplicate', label: 'Duplicate' },
    { id: 'delete', label: 'Delete' },
  ];

  const itemsWithIcons = [
    { id: 'edit', label: 'Edit', icon: <Edit size={14} /> },
    { id: 'copy', label: 'Copy', icon: <Copy size={14} /> },
    { id: 'download', label: 'Download', icon: <Download size={14} /> },
    { id: 'share', label: 'Share', icon: <Share2 size={14} /> },
    { type: 'separator' as const },
    { id: 'delete', label: 'Delete', icon: <Trash2 size={14} /> },
  ];

  const handleSelect = (id: string) => {
    alert(`Selected: ${id}`);
  };

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Basic</Heading>
        <ButtonMore items={basicItems} onSelect={handleSelect} />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Default vertical dots icon
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Icons</Heading>
        <ButtonMore items={itemsWithIcons} onSelect={handleSelect} />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Menu items with icons and separator
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Horizontal Icon</Heading>
        <ButtonMore items={basicItems} icon="horizontal" onSelect={handleSelect} />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Horizontal dots variant
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Left Aligned</Heading>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ButtonMore items={basicItems} align="left" onSelect={handleSelect} />
        </div>
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Menu aligned to the left of button
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Button Variants</Heading>
        <div style={{ display: 'flex', gap: '8px' }}>
          <ButtonMore items={basicItems} variant="ghost" onSelect={handleSelect} title="Ghost" />
          <ButtonMore items={basicItems} variant="secondary" onSelect={handleSelect} title="Secondary" />
          <ButtonMore items={basicItems} variant="primary" onSelect={handleSelect} title="Primary" />
        </div>
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Different button style variants
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Sizes</Heading>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <ButtonMore items={basicItems} size="sm" onSelect={handleSelect} title="Small" />
          <ButtonMore items={basicItems} size="md" onSelect={handleSelect} title="Medium" />
        </div>
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Small and medium sizes
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled</Heading>
        <ButtonMore items={basicItems} disabled />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Disabled state
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>In Context</Heading>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          minWidth: '280px'
        }}>
          <span style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
            List Item Title
          </span>
          <ButtonMore items={itemsWithIcons} onSelect={handleSelect} />
        </div>
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Common use case: row actions
        </Text>
      </div>
    </div>
  );
}
