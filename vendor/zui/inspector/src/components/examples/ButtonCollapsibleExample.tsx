import { useState } from 'react';
import { ButtonCollapsible, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function buttoncollapsibleExample() {
  const [collapsed1, setCollapsed1] = useState(false);
  const [collapsed2, setCollapsed2] = useState(true);
  const [collapsed3, setCollapsed3] = useState(false);
  const [collapsed4, setCollapsed4] = useState(false);

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default (Down)</Heading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ButtonCollapsible
            isCollapsed={collapsed1}
            onClick={() => setCollapsed1(!collapsed1)}
            title={collapsed1 ? 'Expand' : 'Collapse'}
          />
          <Text size="sm" variant="secondary">
            {collapsed1 ? 'Collapsed' : 'Expanded'}
          </Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Size</Heading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ButtonCollapsible
            size="sm"
            isCollapsed={collapsed2}
            onClick={() => setCollapsed2(!collapsed2)}
            title={collapsed2 ? 'Expand' : 'Collapse'}
          />
          <Text size="sm" variant="secondary">
            {collapsed2 ? 'Collapsed' : 'Expanded'}
          </Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>All Directions</Heading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <ButtonCollapsible direction="down" size="sm" />
            <Text size="xs" variant="muted">down</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <ButtonCollapsible direction="up" size="sm" />
            <Text size="xs" variant="muted">up</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <ButtonCollapsible direction="left" size="sm" />
            <Text size="xs" variant="muted">left</Text>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <ButtonCollapsible direction="right" size="sm" />
            <Text size="xs" variant="muted">right</Text>
          </div>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled</Heading>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <ButtonCollapsible disabled />
          <Text size="sm" variant="secondary">Disabled state</Text>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Content</Heading>
        <div style={{ 
          border: '1px solid var(--color-border)', 
          borderRadius: 'var(--radius-md)',
          overflow: 'hidden'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            padding: '8px 12px',
            background: 'var(--color-surface)',
            cursor: 'pointer'
          }} onClick={() => setCollapsed3(!collapsed3)}>
            <ButtonCollapsible
              size="sm"
              isCollapsed={collapsed3}
              onClick={(e) => {
                e.stopPropagation();
                setCollapsed3(!collapsed3);
              }}
            />
            <Text size="sm" className={styles.sectionHeaderText}>Section Header</Text>
          </div>
          {!collapsed3 && (
            <div style={{ padding: '12px', borderTop: '1px solid var(--color-border)' }}>
              <Text size="sm" variant="secondary">
                This content is shown when expanded. Click the chevron or header to collapse.
              </Text>
            </div>
          )}
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Direction with Collapse</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Different directions rotate -90deg when collapsed
        </Text>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ButtonCollapsible 
              direction="right" 
              size="sm"
              isCollapsed={collapsed4}
              onClick={() => setCollapsed4(!collapsed4)}
            />
            <Text size="xs" variant="muted">right</Text>
          </div>
        </div>
      </div>
    </div>
  );
}
