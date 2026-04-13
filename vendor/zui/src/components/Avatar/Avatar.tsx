import { type HTMLAttributes } from 'react';
import clsx from 'clsx';
import { User, type LucideIcon } from 'lucide-react';
import styles from './Avatar.module.css';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The name to generate initials from (if no src is provided)
   */
  name: string;
  /**
   * The image URL
   */
  src?: string;
  /**
   * Alt text for the image
   */
  alt?: string;
  /**
   * Size variant
   * @default 'md'
   */
  size?: AvatarSize;
  /**
   * Whether to use a square shape instead of circle
   * @default false
   */
  square?: boolean;
  /**
   * Lucide icon to show instead of initials when no image is set.
   * Pass `true` to use the default User icon, or pass a custom LucideIcon.
   * @default false (shows initials)
   */
  icon?: boolean | LucideIcon;
}

/**
 * Generate initials from a name
 * Takes first letter of first two words, uppercase
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Map size to icon size in pixels */
const iconSizeMap: Record<AvatarSize, number> = {
  xs: 10,
  sm: 12,
  md: 14,
  lg: 20,
  xl: 28,
};

export function Avatar({
  name,
  src,
  alt,
  size = 'md',
  square = false,
  icon = false,
  className,
  ...props
}: AvatarProps) {
  const initials = getInitials(name);
  const IconComponent = icon === true ? User : icon || null;
  const iconSize = iconSizeMap[size];

  return (
    <div
      className={clsx(
        styles.avatar,
        styles[size],
        square && styles.square,
        !src && styles.noImage,
        className
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt={alt || name} className={styles.image} />
      ) : IconComponent ? (
        <IconComponent size={iconSize} className={styles.icon} />
      ) : (
        <span className={styles.initials}>{initials}</span>
      )}
    </div>
  );
}
