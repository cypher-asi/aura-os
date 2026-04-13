import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Textarea } from './Textarea';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('Textarea', () => {
  it('renders a textarea element', () => {
    render(<Textarea />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('renders medium size by default', () => {
    render(<Textarea />);
    const textarea = screen.getByRole('textbox');
    expect(hasModuleClass(textarea, 'sm')).toBe(false);
  });

  it('renders small size when specified', () => {
    render(<Textarea size="sm" />);
    const textarea = screen.getByRole('textbox');
    expect(hasModuleClass(textarea, 'sm')).toBe(true);
  });

  it('applies mono font when specified', () => {
    render(<Textarea mono />);
    const textarea = screen.getByRole('textbox');
    expect(hasModuleClass(textarea, 'mono')).toBe(true);
  });

  it('handles value changes', () => {
    const handleChange = vi.fn();
    render(<Textarea onChange={handleChange} />);
    const textarea = screen.getByRole('textbox');

    fireEvent.change(textarea, { target: { value: 'test content' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('can be controlled', () => {
    render(<Textarea value="controlled value" onChange={() => {}} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveValue('controlled value');
  });

  it('can be disabled', () => {
    render(<Textarea disabled />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toBeDisabled();
  });

  it('applies placeholder', () => {
    render(<Textarea placeholder="Enter text..." />);
    const textarea = screen.getByPlaceholderText('Enter text...');
    expect(textarea).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<Textarea className="custom-class" />);
    const textarea = screen.getByRole('textbox');
    expect(textarea.className).toContain('custom-class');
  });

  it('forwards ref', () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    render(<Textarea ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLTextAreaElement);
  });

  it('accepts rows prop', () => {
    render(<Textarea rows={5} />);
    const textarea = screen.getByRole('textbox');
    expect(textarea).toHaveAttribute('rows', '5');
  });
});
