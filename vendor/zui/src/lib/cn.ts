import clsx, { ClassValue } from 'clsx';

/**
 * Utility function for constructing className strings conditionally
 * Wrapper around clsx for consistent usage across the UI kit
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
