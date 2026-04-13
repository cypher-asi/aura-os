import { forwardRef, type SelectHTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Select.module.css';

export type SelectSize = 'sm' | 'md';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: SelectSize;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ size = 'md', className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={clsx(styles.select, size === 'sm' && styles.sm, className)}
        {...props}
      >
        {children}
      </select>
    );
  }
);

Select.displayName = 'Select';
