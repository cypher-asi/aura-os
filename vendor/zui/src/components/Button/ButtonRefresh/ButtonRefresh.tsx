import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, type ButtonVariant, type ButtonSize } from '../Button';
import clsx from 'clsx';
import styles from './ButtonRefresh.module.css';

export interface ButtonRefreshProps {
  /** Click handler */
  onRefresh: () => void;
  /** Whether the refresh is in progress */
  isRefreshing?: boolean;
  /** Button title/tooltip */
  title?: string;
  /** Button size variant */
  size?: ButtonSize;
  /** Button style variant */
  variant?: ButtonVariant;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional CSS class */
  className?: string;
}

export function ButtonRefresh({
  onRefresh,
  isRefreshing = false,
  title = 'Refresh',
  size = 'sm',
  variant = 'ghost',
  disabled = false,
  className,
}: ButtonRefreshProps) {
  const iconSize = size === 'sm' ? 14 : 16;
  const [isClicking, setIsClicking] = useState(false);

  const handleClick = () => {
    setIsClicking(true);
    onRefresh();
  };

  useEffect(() => {
    if (isClicking) {
      const timer = setTimeout(() => {
        setIsClicking(false);
      }, 600); // Duration of one rotation
      return () => clearTimeout(timer);
    }
  }, [isClicking]);

  const getIconClassName = () => {
    if (isRefreshing) return styles.spinning;
    if (isClicking) return styles.rotating;
    return '';
  };

  return (
    <Button
      variant={variant}
      size={size}
      iconOnly
      onClick={handleClick}
      disabled={disabled || isRefreshing}
      title={title}
      className={className}
    >
      <RefreshCw size={iconSize} strokeWidth={2} className={clsx(styles.icon, getIconClassName())} />
    </Button>
  );
}
