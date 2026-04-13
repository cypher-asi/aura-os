import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Badge', () => {
  describe('variants', () => {
    it('should render running variant', () => {
      render(<Badge variant="running">Running</Badge>);
      const badge = screen.getByText('Running');
      expect(hasModuleClass(badge, 'running')).toBe(true);
    });

    it('should render stopped variant', () => {
      render(<Badge variant="stopped">Stopped</Badge>);
      const badge = screen.getByText('Stopped');
      expect(hasModuleClass(badge, 'stopped')).toBe(true);
    });

    it('should render error variant', () => {
      render(<Badge variant="error">Error</Badge>);
      const badge = screen.getByText('Error');
      expect(hasModuleClass(badge, 'error')).toBe(true);
    });

    it('should render pending variant', () => {
      render(<Badge variant="pending">Pending</Badge>);
      const badge = screen.getByText('Pending');
      expect(hasModuleClass(badge, 'pending')).toBe(true);
    });

    it('should render provisioning variant', () => {
      render(<Badge variant="provisioning">Provisioning</Badge>);
      const badge = screen.getByText('Provisioning');
      expect(hasModuleClass(badge, 'provisioning')).toBe(true);
    });
  });

  describe('pulse', () => {
    it('should apply pulse class when pulse is true', () => {
      render(
        <Badge variant="running" pulse>
          Running
        </Badge>
      );
      const badge = screen.getByText('Running');
      expect(hasModuleClass(badge, 'pulse')).toBe(true);
    });

    it('should render pulse dot when pulse is true', () => {
      render(
        <Badge variant="running" pulse>
          Running
        </Badge>
      );
      const badge = screen.getByText('Running');
      // The dot has a CSS module class, find it by checking children
      const dot = badge.querySelector('span');
      expect(dot).toBeInTheDocument();
    });

    it('should not apply pulse class by default', () => {
      render(<Badge variant="running">Running</Badge>);
      const badge = screen.getByText('Running');
      expect(hasModuleClass(badge, 'pulse')).toBe(false);
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      render(
        <Badge variant="running" className="custom-badge">
          Running
        </Badge>
      );
      const badge = screen.getByText('Running');
      expect(badge).toHaveClass('custom-badge');
    });
  });

  describe('children', () => {
    it('should render children correctly', () => {
      render(<Badge variant="running">Custom Content</Badge>);
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });

    it('should render complex children', () => {
      render(
        <Badge variant="running">
          <span data-testid="icon">🚀</span> Running
        </Badge>
      );
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
  });
});
