import { type HTMLAttributes } from 'react';
import clsx from 'clsx';
import styles from './Badge.module.css';

export type BadgeVariant = 'running' | 'stopped' | 'error' | 'pending' | 'provisioning';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant: BadgeVariant;
  pulse?: boolean;
}

export function Badge({
  variant,
  pulse = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={clsx(styles.badge, styles[variant], pulse && styles.pulse, className)}
      {...props}
    >
      {pulse && <span className={styles.dot} />}
      {children}
    </span>
  );
}
