import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  contentClassName?: string;
  titleClassName?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  size?: ModalSize;
  /** Make modal take full available height */
  fullHeight?: boolean;
  /** Remove default padding from content area */
  noPadding?: boolean;
}

export function Modal({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  headerActions,
  className,
  contentClassName,
  titleClassName,
  initialFocusRef,
  size = 'md',
  fullHeight = false,
  noPadding = false,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    // Focus on the modal or an initial element when it opens
    if (initialFocusRef?.current) {
      initialFocusRef.current.focus();
    } else {
      modalRef.current?.focus();
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, initialFocusRef]);

  if (!isOpen) return null;

  return createPortal(
    <div className={styles.overlay} role="dialog" aria-modal="true" onClick={onClose}>
      <div
        ref={modalRef}
        className={clsx(styles.modal, styles[size], fullHeight && styles.fullHeight, className)}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <div className={styles.headerTitleGroup}>
            <h2 className={clsx(styles.title, titleClassName)}>{title}</h2>
            {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
          </div>
          <div className={styles.headerRight}>
            {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
            <button onClick={onClose} className={styles.closeButton}>
              <X size={20} />
            </button>
          </div>
        </div>
        <div
          className={clsx(
            styles.content,
            noPadding && styles.noPadding,
            fullHeight && styles.contentFullHeight,
            contentClassName
          )}
        >
          {children}
        </div>
        {footer && <div className={styles.footer}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
