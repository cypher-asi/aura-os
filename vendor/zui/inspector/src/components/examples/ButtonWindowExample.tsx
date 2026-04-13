import { ButtonWindow, Heading } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function buttonwindowExample() {
  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Minimize</Heading>
        <ButtonWindow action="minimize" onClick={() => alert('Minimize clicked!')} />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Maximize</Heading>
        <ButtonWindow action="maximize" onClick={() => alert('Maximize clicked!')} />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Close</Heading>
        <ButtonWindow action="close" onClick={() => alert('Close clicked!')} />
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Extra Small (16px)</Heading>
        <div style={{ display: 'flex', gap: '4px' }}>
          <ButtonWindow action="minimize" size="xs" />
          <ButtonWindow action="maximize" size="xs" />
          <ButtonWindow action="close" size="xs" />
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Small (22px)</Heading>
        <div style={{ display: 'flex', gap: '4px' }}>
          <ButtonWindow action="minimize" size="sm" />
          <ButtonWindow action="maximize" size="sm" />
          <ButtonWindow action="close" size="sm" />
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Compact Title Bar</Heading>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '2px 8px',
          backgroundColor: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          minWidth: '280px',
          height: '20px'
        }}>
          <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Window Title
          </span>
          <div style={{ display: 'flex', gap: '2px' }}>
            <ButtonWindow action="minimize" size="xs" />
            <ButtonWindow action="maximize" size="xs" />
            <ButtonWindow action="close" size="xs" />
          </div>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Standard Title Bar</Heading>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: 'var(--color-surface)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          minWidth: '280px'
        }}>
          <span style={{ color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)' }}>
            Window Title
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <ButtonWindow action="minimize" />
            <ButtonWindow action="maximize" />
            <ButtonWindow action="close" />
          </div>
        </div>
      </div>

      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Disabled</Heading>
        <div style={{ display: 'flex', gap: '4px' }}>
          <ButtonWindow action="minimize" disabled />
          <ButtonWindow action="maximize" disabled />
          <ButtonWindow action="close" disabled />
        </div>
      </div>
    </div>
  );
}
