# Sidebar Component

A flexible, resizable sidebar container with optional header and footer sections. Perfect for navigation panels, tool palettes, and application sidebars.

## Features

- ✅ **Resizable** - Optional drag-to-resize functionality
- ✅ **Persistent Width** - Saves width to localStorage
- ✅ **Header/Footer Sections** - Fixed sections at top and bottom
- ✅ **Scrollable Content** - Main content area scrolls independently
- ✅ **Customizable Constraints** - Min/max width limits
- ✅ **Accessible** - Proper ARIA attributes and keyboard support

## Basic Usage

```tsx
import { Sidebar } from '@cypher-asi/zui';

function App() {
  return (
    <Sidebar>
      <nav>
        <a href="/home">Home</a>
        <a href="/about">About</a>
      </nav>
    </Sidebar>
  );
}
```

## Resizable Sidebar

Enable resizing with width constraints:

```tsx
<Sidebar
  resizable
  minWidth={200}
  maxWidth={400}
  defaultWidth={240}
  storageKey="my-app-sidebar"
>
  <nav>Navigation content</nav>
</Sidebar>
```

## With Header and Footer

Add fixed header and footer sections:

```tsx
<Sidebar
  resizable
  header={
    <div style={{ padding: '16px' }}>
      <h2>App Name</h2>
    </div>
  }
  footer={
    <div style={{ padding: '16px' }}>
      <button>Settings</button>
      <button>Logout</button>
    </div>
  }
>
  <nav>
    {/* Scrollable navigation items */}
  </nav>
</Sidebar>
```

## Complex Example (Machina App)

Real-world usage from the Machina application:

```tsx
<Sidebar
  resizable
  minWidth={200}
  maxWidth={400}
  defaultWidth={240}
  storageKey="machina-sidebar-width"
  header={
    <div className={styles.sidebarTop}>
      <Teambar />
      <Appbar />
    </div>
  }
  footer={
    <div className={styles.sidebarBottom}>
      <TeamSelector />
      <UserSelector />
    </div>
  }
/>
```

## Props API

### SidebarProps

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | - | Main content of the sidebar (scrollable) |
| `header` | `ReactNode` | - | Fixed content at the top |
| `footer` | `ReactNode` | - | Fixed content at the bottom |
| `resizable` | `boolean` | `false` | Enable drag-to-resize functionality |
| `minWidth` | `number` | `200` | Minimum width in pixels (when resizable) |
| `maxWidth` | `number` | `400` | Maximum width in pixels (when resizable) |
| `defaultWidth` | `number` | `240` | Initial/default width in pixels |
| `storageKey` | `string` | `'sidebar-width'` | localStorage key for persisting width |
| `resizePosition` | `'left' \| 'right'` | `'right'` | Position of the resize handle |
| `onWidthChange` | `(width: number) => void` | - | Callback when width changes |
| `className` | `string` | - | Additional CSS classes |
| `...props` | `HTMLAttributes` | - | All standard HTML aside attributes |

## Styling

The Sidebar component uses CSS Modules and can be styled in two ways:

### 1. Using className

```tsx
<Sidebar className="my-custom-sidebar">
  {/* content */}
</Sidebar>
```

```css
.my-custom-sidebar {
  background: var(--color-elevated);
  border-right: 2px solid var(--color-accent);
}
```

### 2. Styling Sections

Style the header, content, and footer sections:

```tsx
<Sidebar
  header={<div className="sidebar-header">Header</div>}
  footer={<div className="sidebar-footer">Footer</div>}
>
  <div className="sidebar-content">Content</div>
</Sidebar>
```

## Layout Structure

The Sidebar component has the following internal structure:

```
<aside> (root)
  ├── <div> (resize handle) - only if resizable
  ├── <div> (header) - only if header prop provided
  ├── <div> (content) - scrollable main content
  └── <div> (footer) - only if footer prop provided
```

## Accessibility

The Sidebar component:
- Uses semantic `<aside>` element
- Supports all standard ARIA attributes via props
- Resize handle is keyboard accessible
- Respects user's motion preferences

## Best Practices

### ✅ DO

- Use `storageKey` to persist width across sessions
- Set reasonable `minWidth` and `maxWidth` constraints
- Keep header and footer content minimal and fixed-height
- Use the content area for scrollable items
- Provide a unique `storageKey` per sidebar instance

### ❌ DON'T

- Put scrollable content in header or footer
- Use extremely small minWidth (< 150px)
- Use extremely large maxWidth (> 600px)
- Forget to handle resize on different screen sizes
- Put heavy content in header/footer (affects performance)

## Examples

### Simple Navigation Sidebar

```tsx
function NavigationSidebar() {
  return (
    <Sidebar defaultWidth={220}>
      <nav>
        <a href="/dashboard">Dashboard</a>
        <a href="/projects">Projects</a>
        <a href="/settings">Settings</a>
      </nav>
    </Sidebar>
  );
}
```

### Tool Palette with Sections

```tsx
function ToolPalette() {
  return (
    <Sidebar
      resizable
      minWidth={180}
      maxWidth={300}
      defaultWidth={220}
      storageKey="tool-palette-width"
      header={
        <div className="palette-header">
          <h3>Tools</h3>
          <button>+</button>
        </div>
      }
    >
      <div className="tool-section">
        <h4>Drawing</h4>
        <button>Pen</button>
        <button>Brush</button>
      </div>
      <div className="tool-section">
        <h4>Selection</h4>
        <button>Select</button>
        <button>Lasso</button>
      </div>
    </Sidebar>
  );
}
```

### File Browser with Status Bar

```tsx
function FileBrowser() {
  const [fileCount, setFileCount] = useState(0);

  return (
    <Sidebar
      resizable
      defaultWidth={260}
      storageKey="file-browser-width"
      footer={
        <div className="status-bar">
          {fileCount} files
        </div>
      }
    >
      <FileTree onFileCountChange={setFileCount} />
    </Sidebar>
  );
}
```

## Implementation Notes

### Width Persistence

The Sidebar automatically saves and restores width using localStorage:

```typescript
// Saved on resize
localStorage.setItem(storageKey, width.toString());

// Restored on mount
const savedWidth = localStorage.getItem(storageKey);
```

### Resize Behavior

The resize handle:
- Only appears when `resizable={true}`
- Shows on hover or during resize
- Constrains width to `minWidth` and `maxWidth`
- Saves width to localStorage on mouse up
- Changes cursor to `ew-resize` during drag

### Performance Considerations

- Width changes use direct DOM manipulation for smooth resizing
- Content area uses `overflow-y: auto` for efficient scrolling
- Header and footer are fixed, preventing unnecessary reflows
- Resize handle uses CSS transforms for optimal performance

## Browser Support

The Sidebar component works in all modern browsers:
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

Requires:
- CSS Custom Properties
- Flexbox
- localStorage API (optional, gracefully degrades)

## Related Components

- **PageLayout** - Full page structure with sidebar support
- **CollapsibleGroup** - Collapsible sections for sidebar content
- **Tabs** - Tabbed navigation for sidebar sections

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | January 2026 | Initial release |
