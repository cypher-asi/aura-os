import { useState } from 'react';
import { Menu, Heading, Badge } from '@cypher-asi/zui';
import type { MenuItem } from '@cypher-asi/zui';
import { Home, Settings, User, LogOut, FileText, Folder, Grid, List, ArrowUpDown, RefreshCw, Plus, Undo, Eye, Monitor, Palette, Copy, Scissors, Clipboard, Save, Trash2, Download, Upload, Star } from 'lucide-react';
import styles from './Example.module.css';

const menuItems = [
  { id: 'home', label: 'Home', icon: <Home size={14} /> },
  { id: 'files', label: 'Files', icon: <Folder size={14} /> },
  { id: 'documents', label: 'Documents', icon: <FileText size={14} /> },
  { id: 'settings', label: 'Settings', icon: <Settings size={14} /> },
  { id: 'profile', label: 'Profile', icon: <User size={14} /> },
  { id: 'logout', label: 'Log Out', icon: <LogOut size={14} />, disabled: false },
];

// Menu items with keyboard shortcuts as status
const editMenuItems: MenuItem[] = [
  { id: 'cut', label: 'Cut', icon: <Scissors size={14} />, status: '⌘X' },
  { id: 'copy', label: 'Copy', icon: <Copy size={14} />, status: '⌘C' },
  { id: 'paste', label: 'Paste', icon: <Clipboard size={14} />, status: '⌘V' },
  { type: 'separator' },
  { id: 'save', label: 'Save', icon: <Save size={14} />, status: '⌘S' },
  { id: 'save-as', label: 'Save As...', icon: <Save size={14} />, status: '⇧⌘S' },
  { type: 'separator' },
  { id: 'delete', label: 'Delete', icon: <Trash2 size={14} />, status: '⌫' },
];

// Menu items with counts/badges as status
const notificationMenuItems: MenuItem[] = [
  { id: 'inbox', label: 'Inbox', icon: <Download size={14} />, status: <Badge variant="solid" size="sm">12</Badge> },
  { id: 'sent', label: 'Sent', icon: <Upload size={14} />, status: '3' },
  { id: 'starred', label: 'Starred', icon: <Star size={14} />, status: '7' },
  { type: 'separator' },
  { id: 'drafts', label: 'Drafts', icon: <FileText size={14} />, status: '2' },
  { id: 'trash', label: 'Trash', icon: <Trash2 size={14} /> },
];

// Mixed status types with submenus
const fileMenuItems: MenuItem[] = [
  { id: 'new', label: 'New', icon: <Plus size={14} />, status: '⌘N', children: [
    { id: 'new-file', label: 'File', icon: <FileText size={14} />, status: '⌘N' },
    { id: 'new-folder', label: 'Folder', icon: <Folder size={14} />, status: '⇧⌘N' },
  ]},
  { id: 'open', label: 'Open...', icon: <Folder size={14} />, status: '⌘O' },
  { id: 'open-recent', label: 'Open Recent', children: [
    { id: 'recent-1', label: 'document.txt', status: '2h ago' },
    { id: 'recent-2', label: 'notes.md', status: '1d ago' },
    { id: 'recent-3', label: 'config.json', status: '3d ago' },
  ]},
  { type: 'separator' },
  { id: 'save', label: 'Save', icon: <Save size={14} />, status: '⌘S' },
  { id: 'export', label: 'Export', icon: <Download size={14} />, status: '⇧⌘E' },
];

// Windows-style context menu with separators and submenus
const contextMenuItems: MenuItem[] = [
  { 
    id: 'view', 
    label: 'View', 
    icon: <Eye size={14} />,
    children: [
      { id: 'view-large', label: 'Large icons', icon: <Grid size={14} /> },
      { id: 'view-medium', label: 'Medium icons', icon: <Grid size={14} /> },
      { id: 'view-small', label: 'Small icons', icon: <Grid size={14} /> },
      { id: 'view-list', label: 'List', icon: <List size={14} /> },
    ]
  },
  { 
    id: 'sort', 
    label: 'Sort by', 
    icon: <ArrowUpDown size={14} />,
    children: [
      { id: 'sort-name', label: 'Name' },
      { id: 'sort-date', label: 'Date modified' },
      { id: 'sort-type', label: 'Type' },
      { id: 'sort-size', label: 'Size' },
    ]
  },
  { id: 'refresh', label: 'Refresh', icon: <RefreshCw size={14} /> },
  { type: 'separator' },
  { id: 'undo', label: 'Undo Rename', icon: <Undo size={14} />, disabled: true },
  { 
    id: 'new', 
    label: 'New', 
    icon: <Plus size={14} />,
    children: [
      { id: 'new-folder', label: 'Folder', icon: <Folder size={14} /> },
      { id: 'new-file', label: 'Text Document', icon: <FileText size={14} /> },
    ]
  },
  { type: 'separator' },
  { id: 'display', label: 'Display settings', icon: <Monitor size={14} /> },
  { id: 'personalize', label: 'Personalize', icon: <Palette size={14} /> },
];

export function menuExample() {
  const [selected1, setSelected1] = useState('home');
  const [selected2, setSelected2] = useState('files');
  const [selected3, setSelected3] = useState('settings');
  const [selected4, setSelected4] = useState('documents');
  const [contextSelected, setContextSelected] = useState('');
  const [editSelected, setEditSelected] = useState('');
  const [notifSelected, setNotifSelected] = useState('inbox');
  const [fileSelected, setFileSelected] = useState('');

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Separators & Submenus</Heading>
        <Menu
          items={contextMenuItems}
          value={contextSelected}
          onChange={setContextSelected}
          variant="solid"
          border="solid"
          rounded="md"
          width={220}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Solid (Default)</Heading>
        <Menu
          items={menuItems}
          selectedId={selected1}
          onSelect={setSelected1}
          variant="solid"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Glass</Heading>
        <Menu
          items={menuItems}
          selectedId={selected2}
          onSelect={setSelected2}
          variant="glass"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Transparent</Heading>
        <Menu
          items={menuItems}
          selectedId={selected3}
          onSelect={setSelected3}
          variant="transparent"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>No Border</Heading>
        <Menu
          items={menuItems}
          selectedId={selected1}
          onSelect={setSelected1}
          variant="solid"
          bordered={false}
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Rounded Corners</Heading>
        <Menu
          items={menuItems}
          selectedId={selected2}
          onSelect={setSelected2}
          variant="solid"
          rounded="md"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Glass Rounded</Heading>
        <Menu
          items={menuItems}
          selectedId={selected3}
          onSelect={setSelected3}
          variant="glass"
          rounded="lg"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Title</Heading>
        <Menu
          title="Navigation"
          items={menuItems}
          selectedId={selected1}
          onSelect={setSelected1}
          variant="solid"
          bordered
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Future Border</Heading>
        <Menu
          items={menuItems}
          selectedId={selected4}
          onSelect={setSelected4}
          variant="solid"
          border="future"
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Future Glass</Heading>
        <Menu
          title="System"
          items={menuItems}
          selectedId={selected4}
          onSelect={setSelected4}
          variant="glass"
          border="future"
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Keyboard Shortcuts</Heading>
        <Menu
          title="Edit"
          items={editMenuItems}
          value={editSelected}
          onChange={setEditSelected}
          background="solid"
          border="solid"
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>With Counts & Badges</Heading>
        <Menu
          title="Mail"
          items={notificationMenuItems}
          value={notifSelected}
          onChange={setNotifSelected}
          background="solid"
          border="solid"
          width={200}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Status with Submenus</Heading>
        <Menu
          title="File"
          items={fileMenuItems}
          value={fileSelected}
          onChange={setFileSelected}
          background="solid"
          border="solid"
          rounded="md"
          width={220}
        />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>No Background</Heading>
        <Menu
          items={editMenuItems}
          value={editSelected}
          onChange={setEditSelected}
          background="none"
          border="none"
          width={200}
        />
      </div>
    </div>
  );
}
