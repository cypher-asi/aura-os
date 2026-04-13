import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Spinner } from './Spinner';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Spinner', () => {
  describe('sizes', () => {
    it('should render medium size by default', () => {
      const { container } = render(<Spinner />);
      const spinner = container.firstChild as HTMLElement;
      expect(spinner).toBeInTheDocument();
      expect(hasModuleClass(spinner, 'spinnerSm')).toBe(false);
      expect(hasModuleClass(spinner, 'spinnerLg')).toBe(false);
    });

    it('should render small size', () => {
      const { container } = render(<Spinner size="sm" />);
      const spinner = container.firstChild as HTMLElement;
      expect(hasModuleClass(spinner, 'spinnerSm') || hasModuleClass(spinner, 'Sm')).toBe(true);
    });

    it('should render large size', () => {
      const { container } = render(<Spinner size="lg" />);
      const spinner = container.firstChild as HTMLElement;
      expect(hasModuleClass(spinner, 'spinnerLg') || hasModuleClass(spinner, 'Lg')).toBe(true);
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      const { container } = render(<Spinner className="custom-spinner" />);
      const spinner = container.firstChild as HTMLElement;
      expect(spinner).toHaveClass('custom-spinner');
    });
  });

  describe('rendering', () => {
    it('should render spinner element', () => {
      const { container } = render(<Spinner />);
      const spinner = container.firstChild as HTMLElement;
      expect(spinner).toBeInTheDocument();
    });

    it('should render as div element', () => {
      const { container } = render(<Spinner />);
      const spinner = container.firstChild as HTMLElement;
      expect(spinner.tagName).toBe('DIV');
    });
  });
});
