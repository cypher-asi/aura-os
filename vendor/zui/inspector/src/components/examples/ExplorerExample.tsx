import { useState } from 'react';
import { CodeBlock, Explorer, ExplorerNode, Heading, Panel, Text } from '@cypher-asi/zui';
import { Folder, File, FileText, Image, Code, Settings, Package } from 'lucide-react';
import styles from './Example.module.css';

const fileTreeData: ExplorerNode[] = [
  {
    id: 'src',
    label: 'src',
    icon: <Folder size={16} />,
    children: [
      {
        id: 'components',
        label: 'components',
        icon: <Folder size={16} />,
        children: [
          {
            id: 'atomic',
            label: 'atomic',
            icon: <Folder size={16} />,
            children: [
              { id: 'Button.tsx', label: 'Button.tsx', icon: <Code size={16} /> },
              { id: 'Input.tsx', label: 'Input.tsx', icon: <Code size={16} /> },
              { id: 'Badge.tsx', label: 'Badge.tsx', icon: <Code size={16} /> },
            ],
          },
          {
            id: 'composite',
            label: 'composite',
            icon: <Folder size={16} />,
            children: [
              { id: 'Card.tsx', label: 'Card.tsx', icon: <Code size={16} /> },
              { id: 'Modal.tsx', label: 'Modal.tsx', icon: <Code size={16} /> },
              { id: 'Drawer.tsx', label: 'Drawer.tsx', icon: <Code size={16} /> },
            ],
          },
        ],
      },
      {
        id: 'styles',
        label: 'styles',
        icon: <Folder size={16} />,
        children: [
          { id: 'index.css', label: 'index.css', icon: <FileText size={16} /> },
          { id: 'tokens.css', label: 'tokens.css', icon: <FileText size={16} /> },
        ],
      },
      { id: 'index.ts', label: 'index.ts', icon: <Code size={16} /> },
    ],
  },
  {
    id: 'public',
    label: 'public',
    icon: <Folder size={16} />,
    children: [
      { id: 'logo.svg', label: 'logo.svg', icon: <Image size={16} /> },
      { id: 'favicon.ico', label: 'favicon.ico', icon: <Image size={16} /> },
    ],
  },
  { id: 'package.json', label: 'package.json', icon: <Package size={16} /> },
  { id: 'README.md', label: 'README.md', icon: <FileText size={16} /> },
  { id: 'tsconfig.json', label: 'tsconfig.json', icon: <Settings size={16} /> },
];

const simpleData: ExplorerNode[] = [
  {
    id: '1',
    label: 'Documents',
    icon: <Folder size={16} />,
    children: [
      { id: '1-1', label: 'Report.pdf', icon: <File size={16} /> },
      { id: '1-2', label: 'Notes.txt', icon: <FileText size={16} /> },
    ],
  },
  {
    id: '2',
    label: 'Images',
    icon: <Folder size={16} />,
    children: [
      { id: '2-1', label: 'Photo1.jpg', icon: <Image size={16} /> },
      { id: '2-2', label: 'Photo2.jpg', icon: <Image size={16} /> },
    ],
  },
  { id: '3', label: 'Config.yaml', icon: <Settings size={16} /> },
];

export function explorerExample() {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [treeData] = useState<ExplorerNode[]>(fileTreeData);
  const [logMessages, setLogMessages] = useState<string[]>([]);

  const addLog = (message: string) => {
    setLogMessages((prev) => [...prev, `${new Date().toLocaleTimeString()}: ${message}`].slice(-5));
  };

  const handleSelect = (ids: string[]) => {
    setSelectedIds(ids);
    addLog(`Selected: ${ids.join(', ')}`);
  };

  const handleExpand = (nodeId: string, expanded: boolean) => {
    addLog(`${expanded ? 'Expanded' : 'Collapsed'}: ${nodeId}`);
  };

  const handleDrop = (draggedId: string, targetId: string, position: string) => {
    addLog(`Dropped ${draggedId} ${position} ${targetId}`);
    // In a real app, you would reorder the tree data here
  };

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>File System Explorer</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          A file tree with inline search, nested folders and files. Supports expand/collapse, multi-selection (Ctrl+click, Shift+click), and drag & drop.
        </Text>
        <Panel>
          <Explorer
            data={treeData}
            onSelect={handleSelect}
            onExpand={handleExpand}
            onDrop={handleDrop}
            defaultExpandedIds={['src', 'components']}
            searchable
          />
        </Panel>
        <div style={{ marginTop: '12px' }}>
          <strong style={{ color: 'var(--color-text-primary, #e6e8eb)', fontSize: '13px' }}>
            Selected: {selectedIds.length > 0 ? selectedIds.join(', ') : 'None'}
          </strong>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Simple Explorer</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          A simpler tree structure without drag & drop or search.
        </Text>
        <Panel>
          <Explorer
            data={simpleData}
            enableDragDrop={false}
            defaultExpandedIds={['1']}
          />
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Disabled Items</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Explorer with some items disabled (cannot be selected or dragged).
        </Text>
        <Panel>
          <Explorer
            data={[
              {
                id: 'a',
                label: 'Active Folder',
                icon: <Folder size={16} />,
                children: [
                  { id: 'a-1', label: 'Active File', icon: <File size={16} /> },
                  { id: 'a-2', label: 'Disabled File', icon: <File size={16} />, disabled: true },
                ],
              },
              {
                id: 'b',
                label: 'Disabled Folder',
                icon: <Folder size={16} />,
                disabled: true,
                children: [
                  { id: 'b-1', label: 'File', icon: <File size={16} /> },
                ],
              },
            ]}
            defaultExpandedIds={['a', 'b']}
          />
        </Panel>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Event Log</Heading>
        <Text size="sm" variant="secondary" className={styles.exampleDescription}>
          Recent explorer events from the file system example above.
        </Text>
        <Panel>
          <div style={{ padding: '12px', fontFamily: 'monospace', fontSize: '12px', maxHeight: '200px', overflow: 'auto' }}>
            {logMessages.length > 0 ? (
              logMessages.map((msg, i) => (
                <div key={i} style={{ color: 'var(--color-text-secondary, #8b8b8d)', marginBottom: '4px' }}>
                  {msg}
                </div>
              ))
            ) : (
              <div style={{ color: 'var(--color-text-muted, #6b7280)' }}>
                No events yet. Try interacting with the file explorer above.
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className={styles.exampleItem} style={{ gridColumn: '1 / -1' }}>
        <Heading level={3} className={styles.exampleTitle}>Usage</Heading>
        <CodeBlock language="tsx" showLineNumbers>
{`import { Explorer, ExplorerNode } from '@cypher-asi/zui';
import { Folder, File } from 'lucide-react';

const data: ExplorerNode[] = [
  {
    id: 'folder1',
    label: 'My Folder',
    icon: <Folder size={16} />,
    children: [
      { id: 'file1', label: 'document.pdf', icon: <File size={16} /> }
    ]
  }
];

// Basic explorer
<Explorer
  data={data}
  onSelect={(ids) => console.log('Selected:', ids)}
  onDrop={(dragId, targetId, pos) => console.log('Dropped')}
  defaultExpandedIds={['folder1']}
  enableMultiSelect={true}
  enableDragDrop={true}
/>

// With inline search
<Explorer
  data={data}
  searchable
  onSearch={(query) => console.log('Search:', query)}
/>`}
        </CodeBlock>
      </div>
    </div>
  );
}
