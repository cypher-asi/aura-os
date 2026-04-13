import { forwardRef, type InputHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './ButtonRadio.module.css';

export type ButtonRadioSize = 'sm' | 'md';
export type ButtonRadioVariant = 'default' | 'accent';

export interface ButtonRadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  /** Size of the radio button */
  size?: ButtonRadioSize;
  /** Color variant when checked */
  variant?: ButtonRadioVariant;
  /** Optional label text */
  label?: string;
  /** Position of the label */
  labelPosition?: 'left' | 'right';
}

export const ButtonRadio = forwardRef<HTMLInputElement, ButtonRadioProps>(function ButtonRadio(
  {
    size = 'md',
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
        styles.buttonRadio,
        styles[size],
        styles[variant],
        label && styles.withLabel,
        disabled && styles.disabled,
        className
      )}
    >
      <input
        ref={ref}
        type="radio"
        className={styles.input}
        disabled={disabled}
        {...props}
      />
      <span className={styles.circle} />
      {label && (
        <span className={clsx(styles.label, labelPosition === 'left' && styles.labelLeft)}>
          {label}
        </span>
      )}
    </label>
  );
});
