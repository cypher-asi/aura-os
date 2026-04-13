import { useState } from 'react';
import { MenuMega, Heading } from '@cypher-asi/zui';
import type { MenuMegaColumnProps } from '@cypher-asi/zui';
import {
  Code,
  Package,
  Book,
  Headphones,
  Zap,
  Shield,
  Globe,
  Database,
  Cloud,
  Server,
  Settings,
  Users,
  FileText,
  BarChart,
} from 'lucide-react';
import styles from './Example.module.css';

// Products and Resources - 2 column layout
const productColumns: MenuMegaColumnProps[] = [
  {
    title: 'Products',
    items: [
      {
        id: 'api',
        icon: <Code size={18} />,
        label: 'API',
        description: 'Build integrations with our REST API',
      },
      {
        id: 'sdk',
        icon: <Package size={18} />,
        label: 'SDK',
        description: 'Native libraries for popular languages',
      },
      {
        id: 'webhooks',
        icon: <Zap size={18} />,
        label: 'Webhooks',
        description: 'Real-time event notifications',
      },
    ],
  },
  {
    title: 'Resources',
    items: [
      {
        id: 'docs',
        icon: <Book size={18} />,
        label: 'Documentation',
        description: 'Guides and API references',
      },
      {
        id: 'support',
        icon: <Headphones size={18} />,
        label: 'Support',
        description: 'Get help from our team',
      },
      {
        id: 'security',
        icon: <Shield size={18} />,
        label: 'Security',
        description: 'Learn about our security practices',
      },
    ],
  },
];

// Infrastructure - 3 column layout
const infrastructureColumns: MenuMegaColumnProps[] = [
  {
    title: 'Compute',
    items: [
      {
        id: 'servers',
        icon: <Server size={18} />,
        label: 'Virtual Servers',
        description: 'Scalable compute instances',
      },
      {
        id: 'containers',
        icon: <Package size={18} />,
        label: 'Containers',
        description: 'Docker and Kubernetes hosting',
      },
    ],
  },
  {
    title: 'Storage',
    items: [
      {
        id: 'database',
        icon: <Database size={18} />,
        label: 'Databases',
        description: 'Managed SQL and NoSQL',
      },
      {
        id: 'object',
        icon: <Cloud size={18} />,
        label: 'Object Storage',
        description: 'S3-compatible storage',
      },
    ],
  },
  {
    title: 'Network',
    items: [
      {
        id: 'cdn',
        icon: <Globe size={18} />,
        label: 'CDN',
        description: 'Global content delivery',
      },
      {
        id: 'dns',
        icon: <Globe size={18} />,
        label: 'DNS',
        description: 'Domain management',
      },
    ],
  },
];

// Single column - simple navigation
const singleColumn: MenuMegaColumnProps[] = [
  {
    title: 'Account',
    items: [
      {
        id: 'settings',
        icon: <Settings size={18} />,
        label: 'Settings',
        description: 'Manage your account preferences and security',
      },
      {
        id: 'team',
        icon: <Users size={18} />,
        label: 'Team',
        description: 'Invite members and manage permissions',
      },
      {
        id: 'billing',
        icon: <FileText size={18} />,
        label: 'Billing',
        description: 'View invoices and payment methods',
      },
      {
        id: 'usage',
        icon: <BarChart size={18} />,
        label: 'Usage',
        description: 'Monitor resource consumption',
        disabled: true,
      },
    ],
  },
];

// No titles - flat mega menu
const flatColumns: MenuMegaColumnProps[] = [
  {
    items: [
      {
        id: 'flat-api',
        icon: <Code size={18} />,
        label: 'API Reference',
        description: 'Complete API documentation',
      },
      {
        id: 'flat-guides',
        icon: <Book size={18} />,
        label: 'Guides',
        description: 'Step-by-step tutorials',
      },
    ],
  },
  {
    items: [
      {
        id: 'flat-examples',
        icon: <Package size={18} />,
        label: 'Examples',
        description: 'Sample code and projects',
      },
      {
        id: 'flat-changelog',
        icon: <FileText size={18} />,
        label: 'Changelog',
        description: 'Latest updates and releases',
      },
    ],
  },
];

// Placeholder images for demo
const PLACEHOLDER_IMAGE_1 = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=320&h=400&fit=crop';
const PLACEHOLDER_IMAGE_2 = 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=320&h=400&fit=crop';

export function menumegaExample() {
  const [selected1, setSelected1] = useState('api');
  const [selected2, setSelected2] = useState('servers');
  const [selected3, setSelected3] = useState('settings');
  const [selected4, setSelected4] = useState('');
  const [selected5, setSelected5] = useState('');
  const [selected6, setSelected6] = useState('flat-api');
  const [selected7, setSelected7] = useState('api');
  const [selected8, setSelected8] = useState('settings');

  return (
    <div className={styles.exampleGroup}>
      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Two Columns
        </Heading>
        <MenuMega
          columns={productColumns}
          value={selected1}
          onChange={setSelected1}
          background="solid"
          border="solid"
          rounded="md"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Three Columns
        </Heading>
        <MenuMega
          columns={infrastructureColumns}
          value={selected2}
          onChange={setSelected2}
          background="solid"
          border="solid"
          rounded="md"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Single Column
        </Heading>
        <MenuMega
          columns={singleColumn}
          value={selected3}
          onChange={setSelected3}
          background="solid"
          border="solid"
          rounded="md"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Glass Background
        </Heading>
        <MenuMega
          columns={productColumns}
          value={selected4}
          onChange={setSelected4}
          background="glass"
          border="solid"
          rounded="lg"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Future Border
        </Heading>
        <MenuMega
          columns={singleColumn}
          value={selected5}
          onChange={setSelected5}
          background="solid"
          border="future"
          rounded="md"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Without Column Titles
        </Heading>
        <MenuMega
          columns={flatColumns}
          value={selected6}
          onChange={setSelected6}
          background="solid"
          border="solid"
          rounded="md"
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          With Vertical Image
        </Heading>
        <MenuMega
          columns={productColumns}
          value={selected7}
          onChange={setSelected7}
          background="solid"
          border="solid"
          rounded="md"
          image={PLACEHOLDER_IMAGE_1}
        />
      </div>

      <div className={styles.section}>
        <Heading level={3} className={styles.sectionTitle}>
          Single Column with Image
        </Heading>
        <MenuMega
          columns={singleColumn}
          value={selected8}
          onChange={setSelected8}
          background="solid"
          border="solid"
          rounded="md"
          image={PLACEHOLDER_IMAGE_2}
        />
      </div>
    </div>
  );
}
