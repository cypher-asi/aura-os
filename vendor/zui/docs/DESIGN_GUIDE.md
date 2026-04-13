# ZUI Design Guide

## Philosophy

ZUI follows a **monochromatic dark theme** with a professional, minimal, and technical aesthetic. The UI should feel like a high-end developer tool—clean, focused, and distraction-free.

## Color Palette

### Background Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color-bg` | `#09090b` | Main app background |
| `--color-surface` | `#0e0e10` | Cards, panels, elevated surfaces |
| `--color-elevated` | `#131316` | Modals, dropdowns, popovers |
| `--color-border` | `#17171a` | Subtle borders |
| `--color-border-light` | `#1f1f23` | More visible borders, hover states |

### Text Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--color-text-primary` | `#e6e8eb` | Primary text, headings |
| `--color-text-secondary` | `#CCCCCC` | Secondary text, labels |
| `--color-text-muted` | `#6b7280` | Muted text, placeholders, hints |

### Functional Colors (Use Sparingly)
| Token | Value | Usage |
|-------|-------|-------|
| `--color-accent` | `#01a4f4` | Primary actions, links, focus states |
| `--color-success` | `#01f4cb` | Success states, online indicators |
| `--color-warning` | `#01a4f4` | Warning states, caution indicators |
| `--color-error` | `#f4012a` | Error states, destructive actions |
| `--color-pending` | `#cb01f4` | Pending/loading states |

## Color Usage Rules

### ✅ DO
- Use grayscale for 95% of the UI
- Use `rgba(255, 255, 255, 0.XX)` for overlays and subtle effects
- Keep accent colors minimal—only for status and actions
- Use white/gray borders, not colored ones
- Use subtle box-shadows with black, not colored glows

### ❌ DON'T
- Use pink, magenta, or bright gradients
- Use colored backgrounds for large areas
- Use neon glows or "AI slop" aesthetics
- Mix multiple accent colors in the same component
- Use colored shadows or glows (except for status indicators)

## Component Styling

### Buttons
```css
/* Primary - Subtle white */
background: rgba(255, 255, 255, 0.08);
border: 1px solid rgba(255, 255, 255, 0.1);
color: var(--color-text-secondary);

/* Hover */
background: rgba(255, 255, 255, 0.12);
color: var(--color-text-primary);
```

### Inputs
```css
background: rgba(255, 255, 255, 0.03);
border: 1px solid rgba(255, 255, 255, 0.08);

/* Focus - White glow, not colored */
border-color: rgba(255, 255, 255, 0.25);
box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.05);
```

### Cards & Surfaces
```css
background: var(--color-surface);
border: 1px solid var(--color-border);
```

### Modals
```css
background: var(--color-elevated);
border: 1px solid rgba(255, 255, 255, 0.06);
box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
```

## Typography

### Fonts
- **Sans-serif**: Inter (primary UI text)
- **Monospace**: JetBrains Mono (code, technical data)

### Sizes
| Token | Value | Usage |
|-------|-------|-------|
| `--text-2xs` | 10px | Badges, tiny labels |
| `--text-xs` | 12px | Compact UI, secondary captions |
| `--text-sm` | 13px | Body text, inputs, labels, captions, items |
| `--text-base` | 14px | Default text |
| `--text-lg` | 16px | Section headers |
| `--text-xl` | 18px | Page titles |

## Spacing

Use the spacing scale consistently:
- `--space-1` (4px) - Tight spacing
- `--space-2` (8px) - Small gaps
- `--space-3` (12px) - Default gaps
- `--space-4` (16px) - Medium spacing
- `--space-6` (24px) - Large spacing
- `--space-8` (32px) - Extra large spacing

## Icon Sizes

Use consistent icon sizing:
| Token | Value | Usage |
|-------|-------|-------|
| `--icon-xs` | 14px | Tiny indicators, compact UI |
| `--icon-sm` | 16px | Small buttons, tree items |
| `--icon-md` | 18px | Default buttons, menu items |
| `--icon-lg` | 20px | Emphasized icons |
| `--icon-xl` | 24px | Large icons, headers |

## Control Sizes

Interactive elements use standard dimensions for consistency and accessibility:

### Heights
| Token | Value | Usage |
|-------|-------|-------|
| `--control-height-xs` | 28px | Compact controls (window buttons) |
| `--control-height-sm` | 32px | Small buttons, inputs, tree items |
| `--control-height-md` | 36px | Default buttons, inputs, items |
| `--control-height-lg` | 44px | Large buttons, touch-friendly |

### Widths
| Token | Value | Usage |
|-------|-------|-------|
| `--control-width-default` | 200px | Default min-width for buttons and inputs |

Note: Touch targets should be at least 44x44px (--control-height-lg) for accessibility.

## Animations

Keep animations subtle and fast:
- `--transition-fast`: 75ms (micro-interactions)
- `--transition-normal`: 150ms (standard transitions)
- `--transition-slow`: 300ms (modal/panel transitions)

Avoid:
- Rotating elements (except spinners)
- Pulsing glows
- Complex multi-step animations
- Colored animation effects

## Accessibility

- Maintain WCAG 2.1 AA contrast ratios
- Use `:focus-visible` for keyboard navigation
- Include ARIA labels for interactive elements
- Support reduced motion preferences
- Ensure touch targets are at least 44x44px

## Examples

### Good: Clean, Monochromatic
```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  color: var(--color-text-primary);
}
```

### Bad: Colorful, "AI Slop"
```css
.card {
  background: linear-gradient(purple, pink);
  border: 1px solid rgba(244, 114, 182, 0.4);
  box-shadow: 0 0 30px rgba(251, 113, 133, 0.4);
}
```
