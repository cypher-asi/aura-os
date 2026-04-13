import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonRadio } from './ButtonRadio';

describe('ButtonRadio', () => {
  describe('rendering', () => {
    it('should render without crashing', () => {
      render(<ButtonRadio />);
      const radio = screen.getByRole('radio');
      expect(radio).toBeInTheDocument();
    });

    it('should render with label', () => {
      render(<ButtonRadio label="Option 1" />);
      expect(screen.getByText('Option 1')).toBeInTheDocument();
    });

    it('should render without label', () => {
      render(<ButtonRadio />);
      expect(screen.queryByText(/Option/)).not.toBeInTheDocument();
    });
  });

  describe('sizes', () => {
    it('should apply sm size class', () => {
      const { container } = render(<ButtonRadio size="sm" />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/sm/);
    });

    it('should apply md size class by default', () => {
      const { container } = render(<ButtonRadio />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/md/);
    });

    it('should apply md size class explicitly', () => {
      const { container } = render(<ButtonRadio size="md" />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/md/);
    });
  });

  describe('variants', () => {
    it('should apply default variant', () => {
      const { container } = render(<ButtonRadio variant="default" />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/default/);
    });

    it('should apply accent variant', () => {
      const { container } = render(<ButtonRadio variant="accent" />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/accent/);
    });
  });

  describe('interactions', () => {
    it('should call onChange when clicked', () => {
      const handleChange = vi.fn();
      render(<ButtonRadio onChange={handleChange} />);
      const radio = screen.getByRole('radio');
      fireEvent.click(radio);
      expect(handleChange).toHaveBeenCalledTimes(1);
    });

    it('should be checkable', () => {
      render(<ButtonRadio />);
      const radio = screen.getByRole('radio') as HTMLInputElement;
      expect(radio.checked).toBe(false);
      fireEvent.click(radio);
      expect(radio.checked).toBe(true);
    });

    it('should support checked prop', () => {
      render(<ButtonRadio checked onChange={() => {}} />);
      const radio = screen.getByRole('radio') as HTMLInputElement;
      expect(radio.checked).toBe(true);
    });
  });

  describe('disabled state', () => {
    it('should apply disabled class when disabled', () => {
      const { container } = render(<ButtonRadio disabled />);
      const label = container.querySelector('label');
      expect(label?.className).toMatch(/disabled/);
    });

    it('should not call onChange when disabled', () => {
      const handleChange = vi.fn();
      render(<ButtonRadio onChange={handleChange} disabled />);
      const radio = screen.getByRole('radio');
      fireEvent.click(radio);
      expect(handleChange).not.toHaveBeenCalled();
    });

    it('should have disabled attribute', () => {
      render(<ButtonRadio disabled />);
      const radio = screen.getByRole('radio');
      expect(radio).toBeDisabled();
    });
  });

  describe('label position', () => {
    it('should position label on right by default', () => {
      const { container } = render(<ButtonRadio label="Option" />);
      const label = container.querySelector('.label');
      expect(label?.className).not.toMatch(/labelLeft/);
    });

    it('should position label on left when specified', () => {
      const { container } = render(<ButtonRadio label="Option" labelPosition="left" />);
      const label = container.querySelector('.label');
      expect(label?.className).toMatch(/labelLeft/);
    });
  });

  describe('radio button groups', () => {
    it('should work in a radio group', () => {
      render(
        <>
          <ButtonRadio name="group" value="1" />
          <ButtonRadio name="group" value="2" />
          <ButtonRadio name="group" value="3" />
        </>
      );
      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(3);
    });

    it('should allow only one selection in a group', () => {
      render(
        <>
          <ButtonRadio name="group" value="1" data-testid="radio-1" />
          <ButtonRadio name="group" value="2" data-testid="radio-2" />
        </>
      );
      const radio1 = screen.getByTestId('radio-1') as HTMLInputElement;
      const radio2 = screen.getByTestId('radio-2') as HTMLInputElement;

      fireEvent.click(radio1);
      expect(radio1.checked).toBe(true);
      expect(radio2.checked).toBe(false);

      fireEvent.click(radio2);
      expect(radio1.checked).toBe(false);
      expect(radio2.checked).toBe(true);
    });
  });

  describe('HTML attributes', () => {
    it('should accept custom className', () => {
      const { container } = render(<ButtonRadio className="custom-class" />);
      const label = container.querySelector('label');
      expect(label).toHaveClass('custom-class');
    });

    it('should accept name attribute', () => {
      render(<ButtonRadio name="test-group" />);
      const radio = screen.getByRole('radio');
      expect(radio).toHaveAttribute('name', 'test-group');
    });

    it('should accept value attribute', () => {
      render(<ButtonRadio value="option1" />);
      const radio = screen.getByRole('radio');
      expect(radio).toHaveAttribute('value', 'option1');
    });

    it('should accept data attributes', () => {
      render(<ButtonRadio data-testid="custom-radio" />);
      expect(screen.getByTestId('custom-radio')).toBeInTheDocument();
    });

    it('should accept aria attributes', () => {
      render(<ButtonRadio aria-label="Custom label" />);
      const radio = screen.getByRole('radio');
      expect(radio).toHaveAttribute('aria-label', 'Custom label');
    });
  });

  describe('forwarding refs', () => {
    it('should forward ref to input element', () => {
      const ref = { current: null as HTMLInputElement | null };
      render(<ButtonRadio ref={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
      expect(ref.current?.tagName).toBe('INPUT');
    });
  });
});
