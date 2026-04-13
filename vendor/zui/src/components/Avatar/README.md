# Avatar Component

A versatile avatar component that displays user or organization images with automatic fallback to initials.

## Features

- Displays profile images with proper alt text
- Automatic fallback to initials when no image is provided
- Multiple size variants (xs, sm, md, lg, xl)
- Circle or square variants
- Handles name parsing intelligently (first two initials from name)

## Usage

```tsx
import { Avatar } from '@cypher-asi/zui';

// With image
<Avatar name="John Doe" src="/path/to/image.jpg" />

// With initials fallback
<Avatar name="John Doe" />

// Different sizes
<Avatar name="Jane Smith" size="xs" />
<Avatar name="Jane Smith" size="sm" />
<Avatar name="Jane Smith" size="md" /> // default
<Avatar name="Jane Smith" size="lg" />
<Avatar name="Jane Smith" size="xl" />

// Square variant (for organizations/teams)
<Avatar name="Acme Corp" square />

// Custom styling
<Avatar name="John Doe" className="custom-class" />
```

## Props

- `name` (required): Name to generate initials from
- `src`: Image URL
- `alt`: Custom alt text (defaults to name)
- `size`: Size variant ('xs' | 'sm' | 'md' | 'lg' | 'xl'), default: 'md'
- `square`: Use square shape instead of circle, default: false

## Sizes

- `xs`: 20x20px
- `sm`: 24x24px
- `md`: 32x32px (default)
- `lg`: 48x48px
- `xl`: 64x64px

## Initials Logic

The component automatically generates initials from the provided name:
- Takes the first letter of the first two words
- Converts to uppercase
- Example: "John Doe" → "JD"
- Example: "John William Doe" → "JW"
- Example: "John" → "J"
