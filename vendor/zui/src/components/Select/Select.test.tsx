import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select } from './Select';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Select', () => {
  describe('options', () => {
    it('should render options', () => {
      render(
        <Select>
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
          <option value="3">Option 3</option>
        </Select>
      );

      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3);
    });

    it('should render with selected option', () => {
      render(
        <Select defaultValue="2">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      );

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(select.value).toBe('2');
    });
  });

  describe('change handling', () => {
    it('should call onChange when selection changes', () => {
      const handleChange = vi.fn();
      render(
        <Select onChange={handleChange}>
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      );

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '2' } });

      expect(handleChange).toHaveBeenCalled();
    });

    it('should update value on selection', () => {
      render(
        <Select defaultValue="1">
          <option value="1">Option 1</option>
          <option value="2">Option 2</option>
        </Select>
      );

      const select = screen.getByRole('combobox') as HTMLSelectElement;
      fireEvent.change(select, { target: { value: '2' } });

      expect(select.value).toBe('2');
    });
  });

  describe('sizes', () => {
    it('should render medium size by default', () => {
      render(
        <Select>
          <option value="1">Option 1</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(hasModuleClass(select, 'sm')).toBe(false);
    });

    it('should render small size', () => {
      render(
        <Select size="sm">
          <option value="1">Option 1</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(hasModuleClass(select, 'sm')).toBe(true);
    });
  });

  describe('disabled state', () => {
    it('should be disabled when disabled prop is true', () => {
      render(
        <Select disabled>
          <option value="1">Option 1</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(select).toBeDisabled();
    });
  });

  describe('custom className', () => {
    it('should accept custom className', () => {
      render(
        <Select className="custom-select">
          <option value="1">Option 1</option>
        </Select>
      );
      const select = screen.getByRole('combobox');
      expect(select).toHaveClass('custom-select');
    });
  });

  describe('ref forwarding', () => {
    it('should forward ref to select element', () => {
      const ref = vi.fn();
      render(
        <Select ref={ref}>
          <option value="1">Option 1</option>
        </Select>
      );
      expect(ref).toHaveBeenCalled();
    });
  });
});
