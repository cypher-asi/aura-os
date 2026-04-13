import { Heading, Navigator, Text } from '@cypher-asi/zui';
import { useState } from 'react';
import { Home, Users, Settings, FileText, Activity, Bell, Mail, Search, Shield, Database, Cloud, Zap } from 'lucide-react';
import styles from './Example.module.css';

export function navigatorExample() {
  const [activeId, setActiveId] = useState('dashboard');

  const mainNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <Home size={16} /> },
    { id: 'users', label: 'Users', icon: <Users size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={16} /> },
  ];

  const secondaryNavItems = [
    { id: 'activity', label: 'Activity', icon: <Activity size={16} /> },
    { id: 'notifications', label: 'Notifications', icon: <Bell size={16} /> },
    { id: 'messages', label: 'Messages', icon: <Mail size={16} /> },
  ];

  const searchableNavItems = [
    { id: 'dashboard', label: 'Dashboard', icon: <Home size={16} /> },
    { id: 'users', label: 'Users', icon: <Users size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={16} /> },
    { id: 'search', label: 'Search', icon: <Search size={16} /> },
    { id: 'security', label: 'Security', icon: <Shield size={16} /> },
    { id: 'database', label: 'Database', icon: <Database size={16} /> },
    { id: 'cloud', label: 'Cloud Services', icon: <Cloud size={16} /> },
    { id: 'automation', label: 'Automation', icon: <Zap size={16} /> },
  ];

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Basic Navigation List</Heading>
        <div style={{ maxWidth: '300px', background: 'var(--color-bg-secondary)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
          <Navigator
            items={mainNavItems}
            value={activeId}
            onChange={setActiveId}
          />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>Searchable Navigator</Heading>
        <Text size="sm" variant="secondary" style={{ marginBottom: '8px' }}>
          Type to filter navigation items. Matching text is highlighted.
        </Text>
        <div style={{ maxWidth: '300px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)' }}>
          <Navigator
            items={searchableNavItems}
            value={activeId}
            onChange={setActiveId}
            searchable
          />
        </div>
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.exampleTitle}>With Multiple Sections</Heading>
        <div style={{ maxWidth: '300px', background: 'var(--color-bg-secondary)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
          <Navigator
            items={secondaryNavItems}
            value={activeId}
            onChange={setActiveId}
          />
        </div>
      </div>
    </div>
  );
}
