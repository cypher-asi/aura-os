import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Input.module.css';

export type InputSize = 'sm' | 'md';
export type InputVariant = 'default' | 'bare' | 'underline';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: InputSize;
  variant?: InputVariant;
  mono?: boolean;
  /** Optional validation message to show on hover */
  validationMessage?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ size = 'md', variant = 'default', mono = false, className, validationMessage, ...props }, ref) => {
    const inputClass = clsx(
      styles.input,
      size === 'sm' && styles.sm,
      variant === 'bare' && styles.bare,
      variant === 'underline' && styles.underline,
      mono && styles.mono,
      className,
    );

    if (validationMessage) {
      return (
        <div className={styles.inputWrapper}>
          <input
            ref={ref}
            className={inputClass}
            {...props}
          />
          <div className={styles.validationIcon} title={validationMessage}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M8 1.5C4.41 1.5 1.5 4.41 1.5 8C1.5 11.59 4.41 14.5 8 14.5C11.59 14.5 14.5 11.59 14.5 8C14.5 4.41 11.59 1.5 8 1.5ZM8.75 11.25H7.25V9.75H8.75V11.25ZM8.75 8.25H7.25V4.75H8.75V8.25Z"
                fill="currentColor"
              />
            </svg>
          </div>
        </div>
      );
    }

    return (
      <input
        ref={ref}
        className={inputClass}
        {...props}
      />
    );
  }
);

Input.displayName = 'Input';
