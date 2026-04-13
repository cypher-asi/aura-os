import { type ReactNode, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '../../Button';
import styles from './MenuDropdown.module.css';

export interface MenuDropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  divider?: boolean;
}

export interface MenuDropdownProps {
  items: MenuDropdownItem[];
  trigger?: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export function MenuDropdown({ items, trigger, align = 'right', className }: MenuDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        dropdownRef.current && !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Position dropdown relative to trigger, adjusting for viewport edges
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current && dropdownRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 8;

      // Start position: below trigger, aligned to right or left edge
      let top = triggerRect.bottom + 4;
      let left = align === 'right' 
        ? triggerRect.right - dropdownRect.width 
        : triggerRect.left;

      // Adjust if dropdown would go below viewport
      if (top + dropdownRect.height > viewportHeight - padding) {
        top = triggerRect.top - dropdownRect.height - 4;
      }

      // Adjust if dropdown would go beyond right edge
      if (left + dropdownRect.width > viewportWidth - padding) {
        left = viewportWidth - dropdownRect.width - padding;
      }

      // Adjust if dropdown would go beyond left edge
      if (left < padding) {
        left = padding;
      }

      setPosition({ top, left });
    }
  }, [isOpen, align]);

  const handleItemClick = (item: MenuDropdownItem) => {
    if (!item.disabled) {
      item.onClick();
      setIsOpen(false);
    }
  };

  const dropdownContent = isOpen && (
    <div
      ref={dropdownRef}
      className={clsx(styles.dropdown, styles.dropdownPortal)}
      style={{ top: position.top, left: position.left }}
    >
      {items.map((item, index) =>
        item.divider ? (
          <hr key={`divider-${index}`} className={styles.divider} />
        ) : (
          <button
            key={item.id}
            className={clsx(styles.item, item.danger && styles.itemDanger)}
            onClick={(e) => {
              e.stopPropagation();
              handleItemClick(item);
            }}
            disabled={item.disabled}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  );

  return (
    <>
      <div className={clsx(styles.container, className)} ref={triggerRef}>
        {trigger ? (
          <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            className={isOpen ? styles.triggerActive : ''}
          >
            <MoreVertical size={16} />
          </Button>
        )}
      </div>
      {dropdownContent && createPortal(dropdownContent, document.body)}
    </>
  );
}
