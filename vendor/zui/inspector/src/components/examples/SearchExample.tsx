import { useState } from 'react';
import { Search, Heading, Navigator, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function searchExample() {
  const [value, setValue] = useState('');
  const [filterValue, setFilterValue] = useState('');

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Default Search</Heading>
        <Search
          placeholder="Search..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Clear Button</Heading>
        <Search
          placeholder="Type to search..."
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          showClear
          onClear={() => setFilterValue('')}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small Size</Heading>
        <Search
          size="sm"
          placeholder="Filter..."
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled</Heading>
        <Search
          placeholder="Search disabled..."
          disabled
        />
      </div>
    </div>
  );
}

export function searchInlineExample() {
  const [filter, setFilter] = useState('');

  const items = [
    { id: 'home', label: 'Home', icon: '🏠' },
    { id: 'documents', label: 'Documents', icon: '📄' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
    { id: 'downloads', label: 'Downloads', icon: '⬇️' },
    { id: 'music', label: 'Music', icon: '🎵' },
  ];

  const filteredItems = items.filter((item) =>
    item.label.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className={styles.exampleItem} style={{ maxWidth: 280 }}>
      <Heading level={3} className={styles.exampleTitle}>Inline Search with Navigator</Heading>
      <Text variant="secondary" style={{ marginBottom: 12 }}>
        Type to filter the navigation items below
      </Text>
      <div style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 0,
      }}>
        <div style={{ padding: 8 }}>
          <Search
            size="sm"
            placeholder="Filter items..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            showClear
            onClear={() => setFilter('')}
          />
        </div>
        <Navigator
          items={filteredItems}
          onChange={() => {}}
        />
        {filteredItems.length === 0 && (
          <Text variant="muted" style={{ padding: '12px 16px', textAlign: 'center' }}>
            No items match "{filter}"
          </Text>
        )}
      </div>
    </div>
  );
}
