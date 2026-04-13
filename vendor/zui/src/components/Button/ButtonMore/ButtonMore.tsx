import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical, MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import { Button, type ButtonVariant, type ButtonSize } from '../Button';
import { Menu, type MenuItem, type MenuBackground } from '../../Menu';
import styles from './ButtonMore.module.css';

export type ButtonMoreIcon = 'vertical' | 'horizontal';
export type ButtonMoreAlign = 'left' | 'right';

export interface ButtonMoreProps {
  /** Array of menu items to display */
  items: MenuItem[];
  /** Icon orientation: vertical dots (default) or horizontal dots */
  icon?: ButtonMoreIcon;
  /** Menu alignment relative to the button */
  align?: ButtonMoreAlign;
  /** Button size variant */
  size?: ButtonSize;
  /** Button style variant */
  variant?: ButtonVariant;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional CSS class name */
  className?: string;
  /** Callback when a menu item is selected */
  onSelect?: (id: string) => void;
  /** Button title/tooltip */
  title?: string;
  /**
   * Menu background style
   * @default 'solid'
   */
  menuBackground?: MenuBackground;
}

export function ButtonMore({
  items,
  icon = 'vertical',
  align = 'right',
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  className,
  onSelect,
  title = 'More actions',
  menuBackground = 'solid',
}: ButtonMoreProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close menu
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        triggerRef.current && !triggerRef.current.contains(event.target as Node) &&
        menuRef.current && !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Position menu relative to trigger, adjusting for viewport edges
  useLayoutEffect(() => {
    if (isOpen && triggerRef.current && menuRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const menuRect = menuRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const padding = 8;

      // Start position: below trigger, aligned to right or left edge
      let top = triggerRect.bottom + 4;
      let left = align === 'right' 
        ? triggerRect.right - menuRect.width 
        : triggerRect.left;

      // Adjust if menu would go below viewport
      if (top + menuRect.height > viewportHeight - padding) {
        top = triggerRect.top - menuRect.height - 4;
      }

      // Adjust if menu would go beyond right edge
      if (left + menuRect.width > viewportWidth - padding) {
        left = viewportWidth - menuRect.width - padding;
      }

      // Adjust if menu would go beyond left edge
      if (left < padding) {
        left = padding;
      }

      setPosition({ top, left });
    }
  }, [isOpen, align]);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      setIsOpen(!isOpen);
    }
  };

  const handleSelect = (id: string) => {
    setIsOpen(false);
    onSelect?.(id);
  };

  const IconComponent = icon === 'horizontal' ? MoreHorizontal : MoreVertical;

  const menuContent = isOpen && (
    <div
      ref={menuRef}
      className={styles.menuPortal}
      style={{ top: position.top, left: position.left }}
    >
      <Menu
        items={items}
        onChange={handleSelect}
        background={menuBackground}
        rounded="md"
        border="solid"
        isOpen={isOpen}
      />
    </div>
  );

  return (
    <>
      <div ref={triggerRef} className={clsx(styles.container, className)}>
        <Button
          variant={variant}
          size={size}
          iconOnly
          onClick={handleToggle}
          disabled={disabled}
          title={title}
          className={clsx(isOpen && styles.triggerActive)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <IconComponent size={size === 'sm' ? 14 : 16} strokeWidth={2} />
        </Button>
      </div>
      {menuContent && createPortal(menuContent, document.body)}
    </>
  );
}

ButtonMore.displayName = 'ButtonMore';
