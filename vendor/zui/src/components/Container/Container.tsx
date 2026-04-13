import { type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Container.module.css';

export interface ContainerProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  fullBleed?: boolean;
}

export function Container({
  className,
  children,
  fullBleed = false,
  ...props
}: ContainerProps) {
  return (
    <div className={clsx(styles.container, fullBleed && styles.fullBleed, className)} {...props}>
      {children}
    </div>
  );
}
