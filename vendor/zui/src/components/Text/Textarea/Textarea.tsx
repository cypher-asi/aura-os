import { forwardRef, type TextareaHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Textarea.module.css';

export type TextareaSize = 'sm' | 'md';

export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'size'> {
  size?: TextareaSize;
  mono?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ size = 'md', mono = false, className, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        className={clsx(styles.textarea, size === 'sm' && styles.sm, mono && styles.mono, className)}
        {...props}
      />
    );
  }
);

Textarea.displayName = 'Textarea';
