import { useState, useEffect, useRef } from 'react';
import { Explorer, Sidebar, Topbar, ThemePanel, MenuMega, Button } from '@cypher-asi/zui';
import type { ExplorerNode, MenuMegaColumnProps } from '@cypher-asi/zui';
import { Code, Package, Book, Headphones, Zap, Shield, Settings, Users, FileText, BarChart, ChevronDown } from 'lucide-react';
import { components } from './data/componentRegistry';
import type { ComponentInfo } from './data/componentRegistry';
import { ComponentShowcase } from './components/ComponentShowcase';
import { GroupShowcase } from './components/GroupShowcase';
import type { GroupInfo } from './components/GroupShowcase';
import styles from './App.module.css';

// Import validation module - runs automatically in development
import './data/validateRegistry';

const STORAGE_KEY = 'zui-inspector-selected-item';

// ============================================================================
// Mega Menu Data for Topbar Navigation Demo
// ============================================================================

const productsMegaMenu: MenuMegaColumnProps[] = [
  {
    title: 'Products',
    items: [
      { id: 'api', icon: <Code size={18} />, label: 'API', description: 'Build integrations with our REST API' },
      { id: 'sdk', icon: <Package size={18} />, label: 'SDK', description: 'Native libraries for popular languages' },
      { id: 'webhooks', icon: <Zap size={18} />, label: 'Webhooks', description: 'Real-time event notifications' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { id: 'docs', icon: <Book size={18} />, label: 'Documentation', description: 'Guides and API references' },
      { id: 'support', icon: <Headphones size={18} />, label: 'Support', description: 'Get help from our team' },
      { id: 'security', icon: <Shield size={18} />, label: 'Security', description: 'Learn about our security practices' },
    ],
  },
];

const accountMegaMenu: MenuMegaColumnProps[] = [
  {
    title: 'Account',
    items: [
      { id: 'settings', icon: <Settings size={18} />, label: 'Settings', description: 'Manage your account preferences' },
      { id: 'team', icon: <Users size={18} />, label: 'Team', description: 'Invite members and manage permissions' },
      { id: 'billing', icon: <FileText size={18} />, label: 'Billing', description: 'View invoices and payment methods' },
      { id: 'usage', icon: <BarChart size={18} />, label: 'Usage', description: 'Monitor resource consumption' },
    ],
  },
];

// ============================================================================
// TopbarNavItem - Navigation item that opens a mega menu
// ============================================================================

interface TopbarNavItemProps {
  label: string;
  columns: MenuMegaColumnProps[];
  width?: number;
  image?: string;
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  onHover: () => void;
  anyMenuOpen: boolean;
}

function TopbarNavItem({
  label,
  columns,
  width = 480,
  image,
  isOpen,
  onOpen,
  onClose,
  onHover,
  anyMenuOpen,
}: TopbarNavItemProps) {
  const [selected, setSelected] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen, onClose]);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  return (
    <div
      ref={containerRef}
      className={styles.topbarNavItem}
      onMouseEnter={() => {
        if (anyMenuOpen && !isOpen) {
          onHover();
        }
      }}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => (isOpen ? onClose() : onOpen())}
        className={isOpen ? styles.topbarNavButtonActive : undefined}
      >
        {label}
        <ChevronDown size={14} className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`} />
      </Button>
      {isOpen && (
        <div className={styles.megaMenuDropdown} style={{ width }}>
          <MenuMega
            columns={columns}
            value={selected}
            onChange={(id) => {
              setSelected(id);
              onClose();
            }}
            background="glass"
            border="future"
            rounded="md"
            image={image}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================================
// TopbarNav - Manages shared menu state
// ============================================================================

function TopbarNav() {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  return (
    <nav className={styles.topbarNav}>
      <TopbarNavItem
        label="Products"
        columns={productsMegaMenu}
        width={640}
        image="https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=320&h=400&fit=crop"
        isOpen={openMenuId === 'products'}
        onOpen={() => setOpenMenuId('products')}
        onClose={() => setOpenMenuId(null)}
        onHover={() => setOpenMenuId('products')}
        anyMenuOpen={openMenuId !== null}
      />
      <TopbarNavItem
        label="Account"
        columns={accountMegaMenu}
        width={280}
        isOpen={openMenuId === 'account'}
        onOpen={() => setOpenMenuId('account')}
        onClose={() => setOpenMenuId(null)}
        onHover={() => setOpenMenuId('account')}
        anyMenuOpen={openMenuId !== null}
      />
    </nav>
  );
}

const buildExplorerTree = (items: ComponentInfo[]) => {
  const nodes: ExplorerNode[] = [];
  const groups = new Map<string, ExplorerNode>();
  const groupComponents = new Map<string, ComponentInfo[]>();

  // Count components per folder to determine which need grouping
  const folderCounts = new Map<string, number>();
  items.forEach((component) => {
    folderCounts.set(component.folder, (folderCounts.get(component.folder) ?? 0) + 1);
  });

  items.forEach((component) => {
    const leafNode: ExplorerNode = {
      id: component.id,
      label: component.name,
      metadata: { componentId: component.id },
    };

    // Only group if there are multiple components in the same folder
    const folderCount = folderCounts.get(component.folder) ?? 1;
    if (folderCount === 1) {
      nodes.push(leafNode);
      return;
    }

    const groupId = `group:${component.folder.toLowerCase()}`;
    const groupNode = groups.get(groupId);

    // Track components per group
    const existingComponents = groupComponents.get(groupId) ?? [];
    groupComponents.set(groupId, [...existingComponents, component]);

    if (groupNode) {
      groupNode.children = [...(groupNode.children ?? []), leafNode];
    } else {
      const newGroup: ExplorerNode = {
        id: groupId,
        label: component.folder,
        children: [leafNode],
      };
      groups.set(groupId, newGroup);
      nodes.push(newGroup);
    }
  });

  // Sort children within groups alphabetically
  nodes.forEach((node) => {
    if (node.children) {
      node.children.sort((a, b) => a.label.localeCompare(b.label));
    }
  });

  // Sort components within each group
  groupComponents.forEach((comps, groupId) => {
    groupComponents.set(groupId, comps.sort((a, b) => a.name.localeCompare(b.name)));
  });

  // Build group info map
  const groupInfoMap = new Map<string, GroupInfo>();
  groups.forEach((node, groupId) => {
    groupInfoMap.set(groupId, {
      id: groupId,
      name: node.label,
      components: groupComponents.get(groupId) ?? [],
    });
  });

  return {
    data: nodes.sort((a, b) => a.label.localeCompare(b.label)),
    groupIds: Array.from(groups.keys()),
    groupInfoMap,
  };
};

const explorerTree = buildExplorerTree(components);
const componentIds = new Set(components.map((component) => component.id));
const groupIds = new Set(explorerTree.groupIds);
const validIds = new Set([...componentIds, ...groupIds]);

const getInitialSelectedId = (): string => {
  const stored = localStorage.getItem(STORAGE_KEY);
  // Validate stored ID exists in component or group list
  if (stored && validIds.has(stored)) {
    return stored;
  }
  return 'button';
};

function App() {
  const [selectedId, setSelectedId] = useState<string>(getInitialSelectedId);

  // Persist selected item to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, selectedId);
  }, [selectedId]);

  const isGroupSelected = selectedId.startsWith('group:');
  const selectedComponent = !isGroupSelected ? components.find(c => c.id === selectedId) : null;
  const selectedGroup = isGroupSelected ? explorerTree.groupInfoMap.get(selectedId) : null;

  const handleExplorerSelect = (selectedIds: string[]) => {
    // Find first valid selection (either component or group)
    const nextSelected = selectedIds.find((id) => validIds.has(id));
    if (nextSelected) {
      setSelectedId(nextSelected);
    }
  };

  const handleComponentSelect = (componentId: string) => {
    setSelectedId(componentId);
  };

  return (
    <div className={styles.app}>
      <Topbar
        title={
          <div className={styles.topbarContent}>
            <span>ZUI <span className={styles.inspectorTitle}>Inspector</span></span>
            <TopbarNav />
          </div>
        }
        actions={<ThemePanel />}
      />
      <div className={styles.body}>
        <Sidebar
          resizable
          minWidth={200}
          maxWidth={400}
          defaultWidth={260}
          storageKey="zui-inspector-main-sidebar-width"
        >
          <div className={styles.sidebarContent}>
            <Explorer
              data={explorerTree.data}
              defaultExpandedIds={explorerTree.groupIds}
              defaultSelectedIds={[selectedId]}
              enableDragDrop={false}
              enableMultiSelect={false}
              expandOnSelect
              onSelect={handleExplorerSelect}
              className={styles.explorer}
              searchable
            />
          </div>
        </Sidebar>
        <main className={styles.main}>
          {selectedComponent && (
            <ComponentShowcase component={selectedComponent} />
          )}
          {selectedGroup && (
            <GroupShowcase group={selectedGroup} onComponentSelect={handleComponentSelect} />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
