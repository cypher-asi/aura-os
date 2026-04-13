# PageHeader Component

A generalized page header component for displaying page titles, metadata, and actions.

## Usage

```tsx
import { PageHeader } from '@zui';

// Basic usage
<PageHeader title="Teams" count={5} />

// With actions
<PageHeader
  title="Machines"
  count={12}
  actions={
    <>
      <RefreshButton onRefresh={handleRefresh} />
      <Button variant="primary">Deploy</Button>
    </>
  }
/>

// With subtitle
<PageHeader
  title="Settings"
  subtitle="Manage your team preferences"
  actions={<Button>Save</Button>}
/>

// With all props
<PageHeader
  title="Deployments"
  subtitle="Infrastructure deployment history"
  count="24 active"
  actions={
    <>
      <Select value={filter} onChange={setFilter}>
        <option value="all">All</option>
        <option value="active">Active</option>
      </Select>
      <RefreshButton onRefresh={refetch} />
    </>
  }
  className="custom-header"
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `title` | `string` | required | Page or section title |
| `subtitle` | `ReactNode` | - | Optional subtitle or description |
| `count` | `number \| string` | - | Item count or metadata to display |
| `actions` | `ReactNode` | - | Actions to render (buttons, filters, etc.) |
| `className` | `string` | - | Additional CSS class |
| `...props` | `HTMLAttributes` | - | All standard HTML div attributes |

## Design

The PageHeader component follows a consistent layout:

```
┌─────────────────────────────────────────────────────────────┐
│  Title (count)  │                              │  [Actions] │
│  Subtitle       │                              │            │
└─────────────────────────────────────────────────────────────┘
```

### Layout Rules

- **Height:** Fixed at 48px
- **Padding:** Horizontal padding of 16px (--space-4)
- **Title:** Primary text, medium weight
- **Subtitle:** Secondary text, smaller size
- **Count:** Monospace font, secondary color
- **Actions:** Right-aligned, flexible width

## Styling

The component uses CSS custom properties for all styling:

```css
/* Colors */
--color-text-primary    /* Title color */
--color-text-secondary  /* Subtitle and count color */

/* Typography */
--text-sm               /* Title size */
--text-xs               /* Subtitle and count size */
--font-medium           /* Title weight */
--font-mono             /* Count font */

/* Spacing */
--space-1               /* Subtitle gap */
--space-2               /* Actions gap */
--space-3               /* Left section gap */
--space-4               /* Header padding */
```

## Accessibility

- Uses semantic `<header>` element
- Title uses `<h1>` for proper document structure
- All interactive elements in actions slot maintain their accessibility
- Supports all ARIA attributes via spread props

## Examples

### In PageLayout

The most common usage is within a PageLayout component:

```tsx
<PageLayout
  title="Teams"
  count={teams?.length ?? 0}
  actions={
    <>
      <RefreshButton onRefresh={refetch} />
      <Button variant="primary" onClick={onCreate}>
        <Plus size={14} />
        Create
      </Button>
    </>
  }
>
  {/* Page content */}
</PageLayout>
```

### Standalone

Can also be used standalone in custom layouts:

```tsx
<div className="custom-page">
  <PageHeader
    title="Dashboard"
    subtitle="Welcome back!"
    count={`Last updated ${lastUpdate}`}
  />
  <div className="page-content">
    {/* Custom content */}
  </div>
</div>
```

### With Complex Actions

Actions can be any React elements:

```tsx
<PageHeader
  title="Machines"
  count={filteredCount}
  actions={
    <>
      {/* Search */}
      <div className={styles.searchContainer}>
        <Search size={14} />
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      
      {/* Filter toggle */}
      <Button
        variant="ghost"
        onClick={() => setShowFilters(!showFilters)}
      >
        <Filter size={14} />
        {filterCount > 0 && <span>{filterCount}</span>}
      </Button>
      
      {/* Refresh */}
      <RefreshButton onRefresh={refetch} />
      
      {/* Primary action */}
      <Button variant="primary" onClick={onCreate}>
        <Plus size={14} />
        Deploy
      </Button>
    </>
  }
/>
```

## Best Practices

### ✅ DO

- Use for consistent page headers across your app
- Keep title concise and descriptive
- Use count for item counts or status metadata
- Group related actions together
- Use semantic action buttons (primary, secondary, ghost)

### ❌ DON'T

- Don't use for section headers within a page (use regular headings)
- Don't put too many actions (keep it focused)
- Don't use for navigation (use breadcrumbs or tabs separately)
- Don't override core styles (use design tokens instead)

## Related Components

- **PageLayout** - Full page structure that uses PageHeader
- **Button** - For action buttons
- **RefreshButton** - Common action for refresh
- **Select** - For filter dropdowns in actions
- **Input** - For search inputs in actions

## Testing

The component includes comprehensive tests. Run them with:

```bash
npm test PageHeader
```

Tests cover:
- Basic rendering
- All prop combinations
- Custom className merging
- Accessibility attributes
- Conditional rendering
