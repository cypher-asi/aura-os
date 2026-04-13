/**
 * ZUI Standard Prop Interfaces
 *
 * This module defines canonical prop interfaces for consistent API design
 * across all ZUI components. Components should extend these interfaces
 * rather than defining their own prop types from scratch.
 */

import type {
  ReactNode,
  HTMLAttributes,
  ButtonHTMLAttributes,
  InputHTMLAttributes,
} from 'react';

// =============================================================================
// SIZE SYSTEM
// =============================================================================

/** Standard component sizes - use for most components */
export type ComponentSize = 'sm' | 'md' | 'lg';

/** Extended sizes for components needing more granularity (Avatar, Modal) */
export type ComponentSizeExtended = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Size prop interface - extend this for sized components */
export interface SizeProps<T extends string = ComponentSize> {
  /**
   * Component size
   * @default 'md'
   */
  size?: T;
}

// =============================================================================
// COMMON BASE PROPS
// =============================================================================

/** Base props that all components should support */
export interface CommonProps {
  /** Additional CSS class name */
  className?: string;
}

/** Props for components that render children */
export interface ChildrenProps {
  /** Component content */
  children?: ReactNode;
}

// =============================================================================
// STATE PROPS
// =============================================================================

/** Props for components with loading state */
export interface LoadingProps {
  /** Whether the component is in a loading state */
  isLoading?: boolean;
}

/** Props for components with disabled state */
export interface DisabledProps {
  /** Whether the component is disabled */
  disabled?: boolean;
}

/** Props for components with selected/active state (single item) */
export interface SelectableProps {
  /** Whether the item is currently selected */
  selected?: boolean;
}

// =============================================================================
// CONTROLLED COMPONENT PATTERNS
// =============================================================================

/** Props for controlled single-value components (Tabs, Menu) */
export interface ControlledValueProps<T = string> {
  /** The controlled value */
  value: T;
  /** Callback when value changes */
  onChange: (value: T) => void;
}

/** Props for controlled open/close components (Modal, Drawer, Dropdown) */
export interface ControlledOpenProps {
  /** Whether the component is open */
  isOpen: boolean;
  /** Callback when the component should close */
  onClose: () => void;
}

/** Props for controlled open with optional open callback (Drawer toggle mode) */
export interface ControlledOpenToggleProps extends ControlledOpenProps {
  /** Callback when the component should open */
  onOpen?: () => void;
}

// =============================================================================
// VISUAL VARIANTS
// =============================================================================

/** Standard button-like variants */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Extended button variants (includes legacy/specialized styles) */
export type ButtonVariantExtended =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'filled'
  | 'glass'
  | 'transparent';

/** Background/surface variants for panels, menus */
export type SurfaceVariant = 'solid' | 'transparent' | 'glass';

/** Text color intensity variants */
export type TextVariant = 'primary' | 'secondary' | 'muted';

/** Status indicators (for badges, indicators) */
export type StatusVariant = 'success' | 'error' | 'warning' | 'info' | 'pending';

/** Props for components with button-like variants */
export interface ButtonVariantProps<T extends string = ButtonVariant> {
  /**
   * Visual variant
   * @default 'primary'
   */
  variant?: T;
}

/** Props for components with surface variants */
export interface SurfaceVariantProps {
  /**
   * Background variant
   * @default 'solid'
   */
  variant?: SurfaceVariant;
}

// =============================================================================
// BORDER & RADIUS
// =============================================================================

/** Standard border radius options */
export type BorderRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';

/** Border style options */
export type BorderStyle = 'none' | 'solid' | 'future';

export interface BorderRadiusProps {
  /**
   * Corner radius
   * @default 'md'
   */
  rounded?: BorderRadius;
}

export interface BorderProps {
  /**
   * Border style
   * @default 'none'
   */
  border?: BorderStyle;
}

// =============================================================================
// LABEL PROPS
// =============================================================================

/** Props for components with a text label */
export interface LabelProps {
  /** Text label to display */
  label: string;
}

/** Props for components with optional label positioning */
export interface LabelPositionProps extends Partial<LabelProps> {
  /** Position of the label relative to the component */
  labelPosition?: 'left' | 'right';
}

// =============================================================================
// ICON PROPS
// =============================================================================

/** Props for components that can display an icon */
export interface IconProps {
  /** Icon element to display */
  icon?: ReactNode;
}

/** Props for icon-only mode (buttons) */
export interface IconOnlyProps {
  /** Render as icon-only (square, no text) */
  iconOnly?: boolean;
}

// =============================================================================
// HTML ATTRIBUTE EXTENSIONS
// =============================================================================

/** Extend for div-based components */
export type DivProps = HTMLAttributes<HTMLDivElement>;

/** Extend for button-based components */
export type NativeButtonProps = ButtonHTMLAttributes<HTMLButtonElement>;

/** Extend for input-based components (omits size to avoid conflict) */
export type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

// =============================================================================
// COMPONENT-SPECIFIC COMPOSITE TYPES
// =============================================================================

/** Standard props for a basic atomic component */
export type AtomicComponentProps = CommonProps & ChildrenProps;

/** Standard props for a button component */
export type StandardButtonProps = CommonProps &
  SizeProps &
  ButtonVariantProps &
  DisabledProps &
  IconProps &
  IconOnlyProps;

/** Standard props for an input component */
export type StandardInputProps = CommonProps & SizeProps & DisabledProps;

/** Standard props for a modal/overlay component */
export type StandardModalProps = CommonProps & ControlledOpenProps & ChildrenProps;
