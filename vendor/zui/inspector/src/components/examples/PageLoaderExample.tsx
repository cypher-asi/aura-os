import { Heading, PageLoader } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function pageloaderExample() {
  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>Page Loader</Heading>
      <div style={{ 
        border: '1px solid var(--color-border)', 
        borderRadius: '8px',
        overflow: 'hidden',
        height: '300px',
        position: 'relative'
      }}>
        <PageLoader />
      </div>
    </div>
  );
}
