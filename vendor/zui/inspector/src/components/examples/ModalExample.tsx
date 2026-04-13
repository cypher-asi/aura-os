import { useState } from 'react';
import { Button, Heading, Modal } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function modalExample() {
  const [isSmallOpen, setIsSmallOpen] = useState(false);
  const [isMediumOpen, setIsMediumOpen] = useState(false);
  const [isLargeOpen, setIsLargeOpen] = useState(false);

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Modal Sizes</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button size="sm" onClick={() => setIsSmallOpen(true)}>
            Small Modal
          </Button>
          <Button size="sm" onClick={() => setIsMediumOpen(true)}>
            Medium Modal
          </Button>
          <Button size="sm" onClick={() => setIsLargeOpen(true)}>
            Large Modal
          </Button>
        </div>
      </div>

      <Modal
        isOpen={isSmallOpen}
        onClose={() => setIsSmallOpen(false)}
        title="Small Modal"
        size="sm"
      >
        <p style={{ color: 'var(--color-text-secondary)' }}>
          This is a small modal dialog.
        </p>
      </Modal>

      <Modal
        isOpen={isMediumOpen}
        onClose={() => setIsMediumOpen(false)}
        title="Medium Modal"
        size="md"
      >
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
          This is a medium-sized modal dialog with more content.
        </p>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          It can contain multiple paragraphs and other elements.
        </p>
      </Modal>

      <Modal
        isOpen={isLargeOpen}
        onClose={() => setIsLargeOpen(false)}
        title="Large Modal"
        size="lg"
      >
        <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1rem' }}>
          This is a large modal dialog suitable for complex forms or detailed content.
        </p>
        <p style={{ color: 'var(--color-text-secondary)' }}>
          You can place any content here, including forms, tables, or other components.
        </p>
      </Modal>
    </div>
  );
}
