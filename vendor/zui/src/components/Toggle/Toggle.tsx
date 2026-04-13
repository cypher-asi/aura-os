import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Toggle.module.css';

export type ToggleSize = 'sm' | 'md';
export type ToggleVariant = 'default' | 'accent';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Size of the toggle */
  size?: ToggleSize;
  /** Color variant when checked */
  variant?: ToggleVariant;
  /** Optional label text */
  label?: string;
  /** Position of the label */
  labelPosition?: 'left' | 'right';
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  {
    size = 'sm',
    variant = 'default',
    label,
    labelPosition = 'right',
    className,
    disabled,
    ...props
  },
  ref
) {
  return (
    <label
      className={clsx(
        styles.toggle,
        styles[size],
        styles[variant],
        label && styles.withLabel,
        disabled && styles.disabled,
        className
      )}
    >
      <input ref={ref} type="checkbox" className={styles.input} disabled={disabled} {...props} />
      <span className={styles.slider} />
      {label && (
        <span className={clsx(styles.label, labelPosition === 'left' && styles.labelLeft)}>
          {label}
        </span>
      )}
    </label>
  );
});

Toggle.displayName = 'Toggle';
