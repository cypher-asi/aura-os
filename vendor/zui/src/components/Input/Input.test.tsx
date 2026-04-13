import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from './Input';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Input', () => {
  describe('change handling', () => {
    it('should call onChange when value changes', () => {
      const handleChange = vi.fn();
      render(<Input onChange={handleChange} />);
      const input = screen.getByRole('textbox');

      fireEvent.change(input, { target: { value: 'test' } });

      expect(handleChange).toHaveBeenCalled();
    });

    it('should update value when typed', () => {
      render(<Input defaultValue="" />);
      const input = screen.getByRole('textbox') as HTMLInputElement;

      fireEvent.change(input, { target: { value: 'new value' } });

      expect(input.value).toBe('new value');
    });
  });

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(<Input disabled />);
      const input = screen.getByRole('textbox');
      expect(input).toBeDisabled();
    });

    it('should not be disabled by default', () => {
      render(<Input />);
      const input = screen.getByRole('textbox');
      expect(input).not.toBeDisabled();
    });
  });

  describe('sizes', () => {
    it('should render medium size by default', () => {
      render(<Input />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'sm')).toBe(false);
    });

    it('should render small size', () => {
      render(<Input size="sm" />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'sm')).toBe(true);
    });
  });

  describe('mono', () => {
    it('should apply mono class when mono is true', () => {
      render(<Input mono />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'mono')).toBe(true);
    });

    it('should not apply mono class by default', () => {
      render(<Input />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'mono')).toBe(false);
    });
  });

  describe('placeholder', () => {
    it('should display placeholder text', () => {
      render(<Input placeholder="Enter value" />);
      const input = screen.getByPlaceholderText('Enter value');
      expect(input).toBeInTheDocument();
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      render(<Input className="custom-input" />);
      const input = screen.getByRole('textbox');
      expect(input).toHaveClass('custom-input');
    });
  });

  describe('types', () => {
    it('should support password type', () => {
      render(<Input type="password" />);
      const input = document.querySelector('input[type="password"]');
      expect(input).toBeInTheDocument();
    });

    it('should support email type', () => {
      render(<Input type="email" />);
      const input = document.querySelector('input[type="email"]');
      expect(input).toBeInTheDocument();
    });
  });

  describe('variant', () => {
    it('should render default variant by default', () => {
      render(<Input />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'bare')).toBe(false);
      expect(hasModuleClass(input, 'underline')).toBe(false);
    });

    it('should apply bare class when variant is bare', () => {
      render(<Input variant="bare" />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'bare')).toBe(true);
    });

    it('should apply underline class when variant is underline', () => {
      render(<Input variant="underline" />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'underline')).toBe(true);
    });

    it('should not apply bare or underline when variant is default', () => {
      render(<Input variant="default" />);
      const input = screen.getByRole('textbox');
      expect(hasModuleClass(input, 'bare')).toBe(false);
      expect(hasModuleClass(input, 'underline')).toBe(false);
    });
  });

  describe('ref forwarding', () => {
    it('should forward ref to input element', () => {
      const ref = vi.fn();
      render(<Input ref={ref} />);
      expect(ref).toHaveBeenCalled();
    });
  });
});
