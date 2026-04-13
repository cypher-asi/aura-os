import { type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Spinner.module.css';

export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
}

export function Spinner({ size = 'md', className, ...props }: SpinnerProps) {
  return (
    <div
      className={clsx(
        styles.spinner,
        size === 'sm' && styles.spinnerSm,
        size === 'lg' && styles.spinnerLg,
        className
      )}
      {...props}
    />
  );
}
