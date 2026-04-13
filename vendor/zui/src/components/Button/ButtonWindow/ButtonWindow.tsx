import { Minus, Square, X } from 'lucide-react';
import clsx from 'clsx';
import { Button, type ButtonSize, type ButtonRounded } from '../Button';
import styles from './ButtonWindow.module.css';

export type ButtonWindowAction = 'minimize' | 'maximize' | 'close';

export interface ButtonWindowProps {
  /** Window action type */
  action: ButtonWindowAction;
  /** Click handler */
  onClick?: () => void;
  /**
   * Size of the button
   * @default 'sm'
   */
  size?: ButtonSize;
  /**
   * Border radius of the button
   * @default 'md'
   */
  rounded?: ButtonRounded;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

const iconMap = {
  minimize: Minus,
  maximize: Square,
  close: X,
} as const;

// Per-icon size adjustments for visual balance
const iconSizeAdjustments: Record<ButtonWindowAction, number> = {
  minimize: 0,
  maximize: -6, // Square appears larger, reduce size
  close: 0,
};

export function ButtonWindow({
  action,
  onClick,
  size = 'sm',
  rounded = 'md',
  disabled = false,
  className,
}: ButtonWindowProps) {
  const Icon = iconMap[action];
  const baseSize = size === 'sm' ? 14 : 16;
  const iconSize = baseSize + iconSizeAdjustments[action];

  return (
    <Button
      variant="ghost"
      size={size}
      rounded={rounded}
      iconOnly
      onClick={onClick}
      disabled={disabled}
      aria-label={action}
      className={clsx(styles.buttonWindow, className)}
    >
      <Icon size={iconSize} strokeWidth={2} />
    </Button>
  );
}

ButtonWindow.displayName = 'ButtonWindow';
