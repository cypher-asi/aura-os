import { useState } from 'react';
import { Item, Heading, Text, Panel } from '@cypher-asi/zui';
import { Home, Settings, Users, FileText, Folder, File, ChevronRight } from 'lucide-react';
import styles from './Example.module.css';

export function itemExample() {
  const [activeId, setActiveId] = useState('home');

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Basic Navigation Items</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Simple items with icon and label, suitable for navigation menus.
        </Text>
        <Panel>
          <div style={{ padding: '8px' }}>
            <Item active={activeId === 'home'} onClick={() => setActiveId('home')}>
              <Item.Icon><Home size={16} /></Item.Icon>
              <Item.Label>Home</Item.Label>
            </Item>
            <Item active={activeId === 'users'} onClick={() => setActiveId('users')}>
              <Item.Icon><Users size={16} /></Item.Icon>
              <Item.Label>Users</Item.Label>
            </Item>
            <Item active={activeId === 'settings'} onClick={() => setActiveId('settings')}>
              <Item.Icon><Settings size={16} /></Item.Icon>
              <Item.Label>Settings</Item.Label>
            </Item>
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Chevron (Expandable)</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items with expand/collapse chevron for tree-like structures.
        </Text>
        <Panel>
          <div style={{ padding: '8px' }}>
            <ExpandableItem />
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Action Slot</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items with a right-aligned action slot for secondary actions.
        </Text>
        <Panel>
          <div style={{ padding: '8px' }}>
            <Item onClick={() => console.log('Documents clicked')}>
              <Item.Icon><FileText size={16} /></Item.Icon>
              <Item.Label>Documents</Item.Label>
              <Item.Action><ChevronRight size={14} /></Item.Action>
            </Item>
            <Item onClick={() => console.log('Settings clicked')}>
              <Item.Icon><Settings size={16} /></Item.Icon>
              <Item.Label>Settings</Item.Label>
              <Item.Action><ChevronRight size={14} /></Item.Action>
            </Item>
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>States</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items in various states: default, selected, and disabled.
        </Text>
        <Panel>
          <div style={{ padding: '8px' }}>
            <Item>
              <Item.Icon><File size={16} /></Item.Icon>
              <Item.Label>Default state</Item.Label>
            </Item>
            <Item selected>
              <Item.Icon><File size={16} /></Item.Icon>
              <Item.Label>Selected state</Item.Label>
            </Item>
            <Item disabled>
              <Item.Icon><File size={16} /></Item.Icon>
              <Item.Label>Disabled state</Item.Label>
            </Item>
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Indentation</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items with indent prop for nested tree structures.
        </Text>
        <Panel>
          <div style={{ padding: '8px' }}>
            <Item>
              <Item.Spacer />
              <Item.Icon><Folder size={16} /></Item.Icon>
              <Item.Label>Root folder</Item.Label>
            </Item>
            <Item indent={20}>
              <Item.Spacer />
              <Item.Icon><Folder size={16} /></Item.Icon>
              <Item.Label>Child folder</Item.Label>
            </Item>
            <Item indent={40}>
              <Item.Spacer />
              <Item.Icon><File size={16} /></Item.Icon>
              <Item.Label>Nested file</Item.Label>
            </Item>
            <Item indent={40}>
              <Item.Spacer />
              <Item.Icon><File size={16} /></Item.Icon>
              <Item.Label>Another file</Item.Label>
            </Item>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ExpandableItem() {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <Item onClick={() => setExpanded(!expanded)}>
        <Item.Chevron expanded={expanded} onToggle={() => setExpanded(!expanded)} />
        <Item.Icon><Folder size={16} /></Item.Icon>
        <Item.Label>Expandable folder</Item.Label>
      </Item>
      {expanded && (
        <>
          <Item indent={28}>
            <Item.Spacer />
            <Item.Icon><File size={16} /></Item.Icon>
            <Item.Label>Child item 1</Item.Label>
          </Item>
          <Item indent={28}>
            <Item.Spacer />
            <Item.Icon><File size={16} /></Item.Icon>
            <Item.Label>Child item 2</Item.Label>
          </Item>
        </>
      )}
    </>
  );
}
