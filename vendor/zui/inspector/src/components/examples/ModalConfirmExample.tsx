import { useState } from 'react';
import { Button, Heading, ModalConfirm } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function modalconfirmExample() {
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isSaveOpen, setIsSaveOpen] = useState(false);

  const handleDelete = () => {
    alert('Item deleted!');
    setIsDeleteOpen(false);
  };

  const handleSave = () => {
    alert('Changes saved!');
    setIsSaveOpen(false);
  };

  return (
    <div className={styles.exampleGrid}>
      <div className={styles.exampleItem}>
        <Heading level={3} className={styles.exampleTitle}>Confirm Actions</Heading>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button variant="danger" size="sm" onClick={() => setIsDeleteOpen(true)}>
            Delete Item
          </Button>
          <Button size="sm" onClick={() => setIsSaveOpen(true)}>
            Save Changes
          </Button>
        </div>
      </div>

      <ModalConfirm
        isOpen={isDeleteOpen}
        onClose={() => setIsDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Confirm Delete"
        message="Are you sure you want to delete this item? This action cannot be undone."
        confirmLabel="Delete"
        danger
      />

      <ModalConfirm
        isOpen={isSaveOpen}
        onClose={() => setIsSaveOpen(false)}
        onConfirm={handleSave}
        title="Save Changes"
        message="Do you want to save your changes?"
        confirmLabel="Save"
      />
    </div>
  );
}
