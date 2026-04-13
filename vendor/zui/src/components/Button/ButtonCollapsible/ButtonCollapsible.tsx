import clsx from 'clsx';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, type ButtonVariant, type ButtonSize } from '../Button';
import styles from './ButtonCollapsible.module.css';

export type ButtonCollapsibleDirection = 'down' | 'up' | 'left' | 'right';

export interface ButtonCollapsibleProps {
  isCollapsed?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  iconClassName?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  type?: 'button' | 'submit' | 'reset';
  direction?: ButtonCollapsibleDirection;
}

const chevronIcons = {
  down: ChevronDown,
  up: ChevronUp,
  left: ChevronLeft,
  right: ChevronRight,
};

export function ButtonCollapsible({
  isCollapsed = false,
  onClick,
  className,
  iconClassName,
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  title,
  ariaLabel,
  type = 'button',
  direction = 'down',
}: ButtonCollapsibleProps) {
  const ChevronIcon = chevronIcons[direction];
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <Button
      type={type}
      variant={variant}
      size={size}
      iconOnly
      className={clsx(styles.button, isCollapsed && styles.collapsed, className)}
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      disabled={disabled}
    >
      <ChevronIcon size={iconSize} strokeWidth={2.5} className={clsx(styles.icon, iconClassName)} />
    </Button>
  );
}
