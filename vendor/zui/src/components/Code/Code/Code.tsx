import { type ReactNode, type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Code.module.css';

export type CodeVariant = 'default' | 'accent';

export interface CodeProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Content to display */
  children: ReactNode;
  /** Visual variant */
  variant?: CodeVariant;
}

/**
 * Code - Inline code component
 *
 * Use for displaying inline code snippets, file paths, or technical terms.
 * For multi-line code blocks, use the CodeBlock component instead.
 */
export function Code({ children, variant = 'default', className, ...props }: CodeProps) {
  return (
    <code className={clsx(styles.code, styles[variant], className)} {...props}>
      {children}
    </code>
  );
}
