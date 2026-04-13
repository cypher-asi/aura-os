import { useState } from 'react';
import { Button, Heading, Toast, Toasts } from '@cypher-asi/zui';
import styles from './Example.module.css';

export function toastsExample() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (type: Toast['type'], title: string, message?: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, type, title, message }]);
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <div className={styles.exampleItem}>
      <Heading level={3} className={styles.exampleTitle}>Toast Notifications</Heading>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <Button
          size="sm"
          onClick={() => addToast('success', 'Success!', 'Operation completed successfully.')}
        >
          Success Toast
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => addToast('error', 'Error', 'An error occurred!')}
        >
          Error Toast
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => addToast('info', 'Information', 'Here is some information.')}
        >
          Info Toast
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => addToast('warning', 'Warning', 'Please review this action.')}
        >
          Warning Toast
        </Button>
      </div>
      <Toasts toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
