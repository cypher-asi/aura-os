import { useState } from 'react';
import { Heading, Tabs } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function tabsExample() {
  const [activeTab, setActiveTab] = useState('tab1');

  const tabs = [
    { id: 'tab1', label: 'Overview' },
    { id: 'tab2', label: 'Settings' },
    { id: 'tab3', label: 'Advanced' },
  ];

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Tab Navigation</Heading>
        <Tabs
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
        <div style={{ 
          padding: '1.5rem', 
          background: 'var(--color-bg-secondary)', 
          borderRadius: '8px',
          marginTop: '1rem'
        }}>
          <p style={{ color: 'var(--color-text-primary)' }}>
            Content for <strong>{tabs.find(t => t.id === activeTab)?.label}</strong> tab
          </p>
        </div>
      </div>
    </div>
  );
}
