import { useState } from 'react';
import { CardItem, Heading, Input, PageList } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function pagelistExample() {
  const [searchQuery, setSearchQuery] = useState('');

  const items = [
    { id: '1', name: 'Item One', description: 'First item description' },
    { id: '2', name: 'Item Two', description: 'Second item description' },
    { id: '3', name: 'Item Three', description: 'Third item description' },
  ];

  const filteredItems = items.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>Page List</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        overflow: 'hidden',
        maxHeight: '500px'
      }}>
        <div style={{ padding: '1rem', borderBottom: '1px solid var(--color-border)' }}>
          <Input
            placeholder="Search items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <PageList>
          {filteredItems.length > 0 ? (
            filteredItems.map((item) => (
              <CardItem
                key={item.id}
                title={item.name}
                onClick={() => alert(`Clicked ${item.name}`)}
                meta={<span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)' }}>{item.description}</span>}
              />
            ))
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
              No items found
            </div>
          )}
        </PageList>
      </div>
    </div>
  );
}
