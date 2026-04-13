import { useState, useCallback } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, type ButtonVariant, type ButtonSize } from '../Button';
import styles from './ButtonCopy.module.css';
import clsx from 'clsx';

export interface ButtonCopyProps {
  /** The text to copy to clipboard */
  text: string;
  /** Click handler called after successful copy */
  onCopy?: () => void;
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
  /** Duration to show checkmark in ms (default: 2000) */
  feedbackDuration?: number;
}

export function ButtonCopy({
  text,
  onCopy,
  title = 'Copy',
  disabled = false,
  size = 'sm',
  variant = 'ghost',
  className,
  feedbackDuration = 2000,
}: ButtonCopyProps) {
  const iconSize = size === 'sm' ? 12 : 14;
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onCopy?.();
      setTimeout(() => setCopied(false), feedbackDuration);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  }, [text, onCopy, feedbackDuration]);

  return (
    <Button
      variant={variant}
      size={size}
      iconOnly
      onClick={handleClick}
      disabled={disabled}
      title={copied ? 'Copied!' : title}
      className={clsx(styles.buttonCopy, copied && styles.copied, className)}
    >
      {copied ? (
        <Check size={iconSize} strokeWidth={2} className={styles.icon} />
      ) : (
        <Copy size={iconSize} strokeWidth={2} className={styles.icon} />
      )}
    </Button>
  );
}

ButtonCopy.displayName = 'ButtonCopy';
