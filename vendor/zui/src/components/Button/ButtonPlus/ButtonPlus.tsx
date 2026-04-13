import { Plus } from 'lucide-react';
import { Button, type ButtonVariant, type ButtonSize } from '../Button';
import styles from './ButtonPlus.module.css';
import clsx from 'clsx';

export interface ButtonPlusProps {
  /** Click handler for the add action */
  onClick: () => void;
  /** Button title/tooltip */
  title?: string;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Button size variant */
  size?: ButtonSize;
  /** Button style variant */
  variant?: ButtonVariant;
  /** Additional CSS class */
  className?: string;
}

export function ButtonPlus({
  onClick,
  title = 'Add',
  disabled = false,
  size = 'sm',
  variant = 'ghost',
  className,
}: ButtonPlusProps) {
  const iconSize = size === 'sm' ? 14 : 16;

  return (
    <Button
      variant={variant}
      size={size}
      iconOnly
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={clsx(styles.buttonPlus, className)}
    >
      <Plus size={iconSize} strokeWidth={2} />
    </Button>
  );
}

ButtonPlus.displayName = 'ButtonPlus';
