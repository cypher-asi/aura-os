import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button';

// Helper to check CSS module class names (they get hashed like _primary_abc123)
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Button', () => {
  describe('variants', () => {
    it('should render primary variant by default', () => {
      render(<Button>Primary</Button>);
      const button = screen.getByRole('button', { name: 'Primary' });
      expect(button).toBeInTheDocument();
      expect(hasModuleClass(button, 'primary')).toBe(true);
    });

    it('should render secondary variant', () => {
      render(<Button variant="secondary">Secondary</Button>);
      const button = screen.getByRole('button', { name: 'Secondary' });
      expect(hasModuleClass(button, 'secondary')).toBe(true);
    });

    it('should render ghost variant', () => {
      render(<Button variant="ghost">Ghost</Button>);
      const button = screen.getByRole('button', { name: 'Ghost' });
      expect(hasModuleClass(button, 'ghost')).toBe(true);
    });

    it('should render danger variant', () => {
      render(<Button variant="danger">Danger</Button>);
      const button = screen.getByRole('button', { name: 'Danger' });
      expect(hasModuleClass(button, 'danger')).toBe(true);
    });
  });

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Button disabled>Disabled</Button>);
      const button = screen.getByRole('button', { name: 'Disabled' });
      expect(button).toBeDisabled();
    });

    it('should not trigger click when disabled', () => {
      const handleClick = vi.fn();
      render(
        <Button disabled onClick={handleClick}>
          Disabled
        </Button>
      );
      const button = screen.getByRole('button', { name: 'Disabled' });
      fireEvent.click(button);
      expect(handleClick).not.toHaveBeenCalled();
    });
  });

  describe('sizes', () => {
    it('should render medium size by default', () => {
      render(<Button>Medium</Button>);
      const button = screen.getByRole('button', { name: 'Medium' });
      expect(hasModuleClass(button, 'sm')).toBe(false);
    });

    it('should render small size', () => {
      render(<Button size="sm">Small</Button>);
      const button = screen.getByRole('button', { name: 'Small' });
      expect(hasModuleClass(button, 'sm')).toBe(true);
    });
  });

  describe('click handling', () => {
    it('should call onClick when clicked', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click me</Button>);
      const button = screen.getByRole('button', { name: 'Click me' });
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('should pass event to onClick handler', () => {
      const handleClick = vi.fn();
      render(<Button onClick={handleClick}>Click me</Button>);
      const button = screen.getByRole('button', { name: 'Click me' });
      fireEvent.click(button);
      expect(handleClick).toHaveBeenCalledWith(expect.any(Object));
    });
  });

  describe('iconOnly mode', () => {
    it('should apply iconOnly styles', () => {
      render(<Button iconOnly>🔍</Button>);
      const button = screen.getByRole('button');
      expect(hasModuleClass(button, 'iconOnly')).toBe(true);
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      render(<Button className="custom-class">Custom</Button>);
      const button = screen.getByRole('button', { name: 'Custom' });
      expect(button).toHaveClass('custom-class');
    });
  });

  describe('dimUnselected', () => {
    it('should not apply noDim class by default', () => {
      render(<Button>Default</Button>);
      const button = screen.getByRole('button', { name: 'Default' });
      expect(hasModuleClass(button, 'noDim')).toBe(false);
    });

    it('should apply noDim class when dimUnselected is false', () => {
      render(<Button dimUnselected={false}>No Dim</Button>);
      const button = screen.getByRole('button', { name: 'No Dim' });
      expect(hasModuleClass(button, 'noDim')).toBe(true);
    });

    it('should not apply noDim class when dimUnselected is true', () => {
      render(<Button dimUnselected={true}>Dim</Button>);
      const button = screen.getByRole('button', { name: 'Dim' });
      expect(hasModuleClass(button, 'noDim')).toBe(false);
    });
  });

  describe('as span', () => {
    it('should render as span element', () => {
      render(<Button as="span">Span Button</Button>);
      const span = screen.getByText('Span Button');
      expect(span.tagName).toBe('SPAN');
    });
  });
});
