import { type HTMLAttributes, type ElementType, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Label.module.css';

export type LabelVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
export type LabelSize = 'xs' | 'sm' | 'md';

export interface LabelProps extends HTMLAttributes<HTMLElement> {
  /** Label text content */
  children: ReactNode;
  /** Semantic color variant */
  variant?: LabelVariant;
  /** Label size */
  size?: LabelSize;
  /** Transform text to uppercase */
  uppercase?: boolean;
  /** Use monospace font */
  mono?: boolean;
  /** Show border */
  border?: boolean;
  /** Element type to render as */
  as?: ElementType;
}

export function Label({
  children,
  variant = 'default',
  size = 'sm',
  uppercase = true,
  mono = false,
  border = false,
  as: Component = 'span',
  className,
  ...props
}: LabelProps) {
  return (
    <Component
      className={clsx(
        styles.label,
        styles[variant],
        styles[size],
        uppercase && styles.uppercase,
        mono && styles.mono,
        border && styles.border,
        className
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
