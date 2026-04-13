import type { ReactNode } from 'react';
import styles from './PageList.module.css';

export interface PageListProps {
  children: ReactNode;
}

export function PageList({ children }: PageListProps) {
  return <div className={styles.list}>{children}</div>;
}
