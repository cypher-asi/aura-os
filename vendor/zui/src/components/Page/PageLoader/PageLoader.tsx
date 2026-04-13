import { Spinner } from '../../Spinner';
import styles from './PageLoader.module.css';

export interface PageLoaderProps {
  message?: string;
}

/** Full-page loading state for route transitions */
export function PageLoader({ message }: PageLoaderProps) {
  return (
    <div className={styles.pageLoader}>
      <Spinner size="lg" />
      {message && <span className={styles.message}>{message}</span>}
    </div>
  );
}
