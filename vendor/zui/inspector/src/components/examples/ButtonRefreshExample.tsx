import { useState } from 'react';
import { ButtonRefresh, Heading, Text } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function buttonrefreshExample() {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshTime, setLastRefreshTime] = useState<Date | null>(null);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      setIsRefreshing(false);
      setLastRefreshTime(new Date());
    }, 2000);
  };

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Basic Refresh Button</Heading>
        <ButtonRefresh
          onRefresh={handleRefresh}
          isRefreshing={isRefreshing}
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          {isRefreshing ? 'Refreshing...' : lastRefreshTime ? `Last refreshed: ${lastRefreshTime.toLocaleTimeString()}` : 'Click to refresh'}
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Quick Refresh (No Loading State)</Heading>
        <ButtonRefresh
          onRefresh={() => setLastRefreshTime(new Date())}
          isRefreshing={false}
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Click to see the rotation animation on each click
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Custom Title</Heading>
        <ButtonRefresh
          onRefresh={() => alert('Custom refresh action!')}
          title="Refresh Data"
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          Hover to see custom title
        </Text>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Larger Icon</Heading>
        <ButtonRefresh
          onRefresh={() => setLastRefreshTime(new Date())}
          iconSize={20}
        />
        <Text size="sm" variant="secondary" style={{ marginTop: '0.5rem', display: 'block' }}>
          20px icon size
        </Text>
      </div>
    </div>
  );
}
