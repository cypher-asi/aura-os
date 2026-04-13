import { useState } from 'react';
import { ItemDetailed, Heading, Text, Panel } from '@cypher-asi/zui';
import { Code, Package, Book, Headphones, Zap, Shield, Settings, Users, FileText, BarChart } from 'lucide-react';
import styles from './Example.module.css';

export function itemdetailedExample() {
  const [selectedId, setSelectedId] = useState<string>('api');

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Basic Usage</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items with icon, label, and description - perfect for mega menus and detailed lists.
        </Text>
        <Panel>
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <ItemDetailed
              id="api"
              icon={<Code size={18} />}
              label="API"
              description="Build integrations with our REST API"
              selected={selectedId === 'api'}
              onClick={() => setSelectedId('api')}
            />
            <ItemDetailed
              id="sdk"
              icon={<Package size={18} />}
              label="SDK"
              description="Native libraries for popular languages"
              selected={selectedId === 'sdk'}
              onClick={() => setSelectedId('sdk')}
            />
            <ItemDetailed
              id="webhooks"
              icon={<Zap size={18} />}
              label="Webhooks"
              description="Real-time event notifications"
              selected={selectedId === 'webhooks'}
              onClick={() => setSelectedId('webhooks')}
            />
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Without Icons</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items can be used without icons for a simpler look.
        </Text>
        <Panel>
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <ItemDetailed
              id="docs"
              label="Documentation"
              description="Guides and API references"
            />
            <ItemDetailed
              id="support"
              label="Support"
              description="Get help from our team"
            />
            <ItemDetailed
              id="security"
              label="Security"
              description="Learn about our security practices"
            />
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>States</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Items support selected and disabled states.
        </Text>
        <Panel>
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <ItemDetailed
              id="default"
              icon={<Settings size={18} />}
              label="Default"
              description="Normal interactive state"
            />
            <ItemDetailed
              id="selected"
              icon={<Users size={18} />}
              label="Selected"
              description="Currently active selection"
              selected
            />
            <ItemDetailed
              id="disabled"
              icon={<FileText size={18} />}
              label="Disabled"
              description="Not available at this time"
              disabled
            />
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Without Description</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Description is optional - items work great with just icon and label.
        </Text>
        <Panel>
          <div style={{ padding: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <ItemDetailed
              id="book"
              icon={<Book size={18} />}
              label="Documentation"
            />
            <ItemDetailed
              id="headphones"
              icon={<Headphones size={18} />}
              label="Support"
            />
            <ItemDetailed
              id="shield"
              icon={<Shield size={18} />}
              label="Security"
            />
            <ItemDetailed
              id="chart"
              icon={<BarChart size={18} />}
              label="Analytics"
            />
          </div>
        </Panel>
      </div>
    </div>
  );
}
