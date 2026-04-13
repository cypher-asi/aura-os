# ZUI Components Architecture

This directory contains all ZUI components organized by their complexity and dependencies.

## Directory Structure

```
components/
├── atomic/          # Atomic components - basic building blocks
├── composite/       # Composite components - complex compositions
└── index.ts         # Main export file
```

## Atomic Components

**Location:** `./atomic/`

Atomic components are the basic building blocks of the design system. They:
- Have minimal or no dependencies on other components
- Are highly reusable
- Provide fundamental UI elements

### Available Atomic Components:
- **Badge** - Status indicators and labels
- **Button** - Interactive buttons with variants
- **Input** - Text input fields
- **RadioButton** - Radio button controls
- **Select** - Dropdown selection controls
- **Spinner** - Loading indicators
- **Textarea** - Multi-line text input
- **Toggle** - Toggle switches

## Composite Components

**Location:** `./composite/`

Composite components are more complex UI patterns built by composing atomic components and other composites. They:
- Depend on atomic components and/or other composites
- Implement specific UI patterns
- Provide higher-level functionality

### Available Composite Components:
- **Card** - Container for content grouping
- **CollapsibleGroup** - Expandable/collapsible sections
- **ConfirmModal** - Confirmation dialog with actions
- **Drawer** - Slide-out panel
- **DropdownMenu** - Action menus
- **ItemCard** - Specialized card for list items
- **Modal** - Dialog overlays
- **Page** - Full page layout wrapper
- **PageEmptyState** - Empty state messaging
- **PageHeader** - Page title and actions
- **PageList** - List view with search/filter
- **PageLoader** - Full-page loading state
- **RefreshButton** - Button with refresh functionality
- **Sidebar** - Resizable sidebar navigation
- **Tabs** - Tabbed navigation
- **Toasts** - Notification messages

## Usage

Import components from the main index:

```typescript
// Import from main package
import { Button, Badge, Modal, PageHeader } from '@cypher-asi/zui';

// Or import from specific category
import { Button, Badge } from '@cypher-asi/zui/components/atomic';
import { Modal, PageHeader } from '@cypher-asi/zui/components/composite';
```

## Guidelines

### When to Create an Atomic Component:
1. The component is a fundamental UI element
2. It has no dependencies on other components (except primitives)
3. It's highly reusable across different contexts
4. It represents a single, focused piece of functionality

### When to Create a Composite Component:
1. The component combines multiple atomic components
2. It implements a specific UI pattern or workflow
3. It has dependencies on other components
4. It provides domain-specific functionality

## Component Structure

Each component follows this structure:

```
ComponentName/
├── ComponentName.tsx           # Component implementation
├── ComponentName.module.css    # Component styles
├── ComponentName.test.tsx      # Unit tests (optional)
├── index.ts                    # Export file
└── README.md                   # Documentation (optional)
```

## Cross-Component Dependencies

- **Atomic → Atomic**: Avoid (use primitives instead)
- **Atomic → Composite**: Never
- **Composite → Atomic**: Encouraged
- **Composite → Composite**: Use sparingly, prefer composition

## Adding New Components

1. Determine if the component is atomic or composite
2. Create the component directory in the appropriate folder
3. Implement the component following the structure above
4. Export from the category index (`atomic/index.ts` or `composite/index.ts`)
5. Export from the main index (`components/index.ts`)
6. Update this README with the new component
