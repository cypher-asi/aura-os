import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Label } from './Label';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Label', () => {
  describe('variants', () => {
    it('should render default variant', () => {
      render(<Label>Default</Label>);
      const label = screen.getByText('Default');
      expect(hasModuleClass(label, 'default')).toBe(true);
    });

    it('should render success variant', () => {
      render(<Label variant="success">Success</Label>);
      const label = screen.getByText('Success');
      expect(hasModuleClass(label, 'success')).toBe(true);
    });

    it('should render warning variant', () => {
      render(<Label variant="warning">Warning</Label>);
      const label = screen.getByText('Warning');
      expect(hasModuleClass(label, 'warning')).toBe(true);
    });

    it('should render danger variant', () => {
      render(<Label variant="danger">Danger</Label>);
      const label = screen.getByText('Danger');
      expect(hasModuleClass(label, 'danger')).toBe(true);
    });

    it('should render info variant', () => {
      render(<Label variant="info">Info</Label>);
      const label = screen.getByText('Info');
      expect(hasModuleClass(label, 'info')).toBe(true);
    });

    it('should render muted variant', () => {
      render(<Label variant="muted">Muted</Label>);
      const label = screen.getByText('Muted');
      expect(hasModuleClass(label, 'muted')).toBe(true);
    });
  });

  describe('sizes', () => {
    it('should render xs size', () => {
      render(<Label size="xs">Extra Small</Label>);
      const label = screen.getByText('Extra Small');
      expect(hasModuleClass(label, 'xs')).toBe(true);
    });

    it('should render sm size by default', () => {
      render(<Label>Small</Label>);
      const label = screen.getByText('Small');
      expect(hasModuleClass(label, 'sm')).toBe(true);
    });

    it('should render md size', () => {
      render(<Label size="md">Medium</Label>);
      const label = screen.getByText('Medium');
      expect(hasModuleClass(label, 'md')).toBe(true);
    });
  });

  describe('uppercase', () => {
    it('should apply uppercase class by default', () => {
      render(<Label>Uppercase</Label>);
      const label = screen.getByText('Uppercase');
      expect(hasModuleClass(label, 'uppercase')).toBe(true);
    });

    it('should not apply uppercase class when false', () => {
      render(<Label uppercase={false}>Lowercase</Label>);
      const label = screen.getByText('Lowercase');
      expect(hasModuleClass(label, 'uppercase')).toBe(false);
    });
  });

  describe('mono', () => {
    it('should not apply mono class by default', () => {
      render(<Label>Normal</Label>);
      const label = screen.getByText('Normal');
      expect(hasModuleClass(label, 'mono')).toBe(false);
    });

    it('should apply mono class when true', () => {
      render(<Label mono>Monospace</Label>);
      const label = screen.getByText('Monospace');
      expect(hasModuleClass(label, 'mono')).toBe(true);
    });
  });

  describe('border', () => {
    it('should not apply border class by default', () => {
      render(<Label>No Border</Label>);
      const label = screen.getByText('No Border');
      expect(hasModuleClass(label, 'border')).toBe(false);
    });

    it('should apply border class when true', () => {
      render(<Label border>With Border</Label>);
      const label = screen.getByText('With Border');
      expect(hasModuleClass(label, 'border')).toBe(true);
    });
  });

  describe('as prop', () => {
    it('should render as span by default', () => {
      render(<Label>Default Element</Label>);
      const label = screen.getByText('Default Element');
      expect(label.tagName).toBe('SPAN');
    });

    it('should render as custom element', () => {
      render(<Label as="div">Div Element</Label>);
      const label = screen.getByText('Div Element');
      expect(label.tagName).toBe('DIV');
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      render(<Label className="custom-label">Custom</Label>);
      const label = screen.getByText('Custom');
      expect(label).toHaveClass('custom-label');
    });
  });

  describe('children', () => {
    it('should render children correctly', () => {
      render(<Label>Custom Content</Label>);
      expect(screen.getByText('Custom Content')).toBeInTheDocument();
    });

    it('should render complex children', () => {
      render(
        <Label>
          <span data-testid="icon">🚀</span> Running
        </Label>
      );
      expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('should pass through aria attributes', () => {
      render(
        <Label role="status" aria-label="Process status">
          Running
        </Label>
      );
      const label = screen.getByText('Running');
      expect(label).toHaveAttribute('role', 'status');
      expect(label).toHaveAttribute('aria-label', 'Process status');
    });
  });
});
