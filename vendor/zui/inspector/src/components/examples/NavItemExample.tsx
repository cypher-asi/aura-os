import { useState } from 'react';
import { Heading, Item } from '@cypher-asi/zui';
import { Home, Settings, Users, FileText, Database } from 'lucide-react';
import styles from './Example.module.css';

export function navitemExample() {
  const [activeId, setActiveId] = useState('home');

  const navItems = [
    { id: 'home', label: 'Home', icon: <Home size={16} /> },
    { id: 'users', label: 'Users', icon: <Users size={16} /> },
    { id: 'database', label: 'Database', icon: <Database size={16} /> },
    { id: 'documents', label: 'Documents', icon: <FileText size={16} /> },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} /> },
  ];

  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>With Icons</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        padding: '0.5rem',
        background: 'var(--color-bg-primary)',
        width: '240px'
      }}>
        {navItems.map((item) => (
          <Item
            key={item.id}
            active={activeId === item.id}
            onClick={() => setActiveId(item.id)}
          >
            <Item.Icon>{item.icon}</Item.Icon>
            <Item.Label>{item.label}</Item.Label>
          </Item>
        ))}
      </div>
    </div>
  );
}

export function navitemWithoutIconExample() {
  const [activeId, setActiveId] = useState('overview');

  const items = [
    { id: 'overview', label: 'Overview' },
    { id: 'details', label: 'Details' },
    { id: 'configuration', label: 'Configuration' },
    { id: 'logs', label: 'Logs' },
  ];

  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>Without Icons</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        padding: '0.5rem',
        background: 'var(--color-bg-primary)',
        width: '240px'
      }}>
        {items.map((item) => (
          <Item
            key={item.id}
            active={activeId === item.id}
            onClick={() => setActiveId(item.id)}
          >
            <Item.Label>{item.label}</Item.Label>
          </Item>
        ))}
      </div>
    </div>
  );
}

export function navitemStatesExample() {
  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>States</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        padding: '0.5rem',
        background: 'var(--color-bg-primary)',
        width: '240px'
      }}>
        <Item onClick={() => {}}>
          <Item.Icon><Home size={16} /></Item.Icon>
          <Item.Label>Default State</Item.Label>
        </Item>
        <Item active onClick={() => {}}>
          <Item.Icon><Settings size={16} /></Item.Icon>
          <Item.Label>Active State</Item.Label>
        </Item>
        <Item onClick={() => {}}>
          <Item.Icon><Users size={16} /></Item.Icon>
          <Item.Label>Hover Me</Item.Label>
        </Item>
      </div>
    </div>
  );
}
