# Container

A flexible container component that provides consistent styling for grouped content.

## Features

- Consistent background, border, and padding
- Uses design system tokens for theming
- Flexible content area with minimum height
- Can be used to wrap any content that needs visual grouping

## Usage

```tsx
import { Container } from '@cypher-asi/zui';

function MyComponent() {
  return (
    <Container>
      <h2>Content Title</h2>
      <p>Your content goes here...</p>
    </Container>
  );
}
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `React.ReactNode` | - | Content to be displayed inside the container |
| `fullBleed` | `boolean` | `false` | If true, removes padding and min-height for full-bleed content |
| `className` | `string` | - | Additional CSS classes |
| `...props` | `HTMLAttributes<HTMLDivElement>` | - | Standard div attributes |

## Styling

The Container uses the following design tokens:
- `--color-bg` for background
- `--color-border` for border
- `--radius-lg` for border radius

## Examples

### Basic Container
```tsx
<Container>
  <p>Simple content</p>
</Container>
```

### With Custom Styling
```tsx
<Container className="my-custom-class" style={{ maxWidth: '600px' }}>
  <p>Custom styled container</p>
</Container>
```

### Full Bleed (No Padding)
```tsx
<Container fullBleed>
  <img src="/image.jpg" alt="Full bleed image" />
</Container>
```

Perfect for wrapping components that need to fill the entire container without padding, like code blocks or images.
