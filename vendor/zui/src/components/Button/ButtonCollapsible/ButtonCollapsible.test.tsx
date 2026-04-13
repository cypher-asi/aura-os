import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonCollapsible } from './ButtonCollapsible';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

describe('ButtonCollapsible', () => {
  it('renders a button', () => {
    render(<ButtonCollapsible ariaLabel="Toggle" />);
    expect(screen.getByRole('button', { name: 'Toggle' })).toBeInTheDocument();
  });

  it('renders expanded state by default', () => {
    render(<ButtonCollapsible ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(hasModuleClass(button, 'collapsed')).toBe(false);
  });

  it('renders collapsed state when isCollapsed is true', () => {
    render(<ButtonCollapsible isCollapsed ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(hasModuleClass(button, 'collapsed')).toBe(true);
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<ButtonCollapsible onClick={handleClick} ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<ButtonCollapsible disabled ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(button).toBeDisabled();
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<ButtonCollapsible disabled onClick={handleClick} ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });

    fireEvent.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies title attribute', () => {
    render(<ButtonCollapsible title="Click to expand" ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(button).toHaveAttribute('title', 'Click to expand');
  });

  it('applies custom className', () => {
    render(<ButtonCollapsible className="custom-class" ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(button.className).toContain('custom-class');
  });

  it('renders small size when specified', () => {
    render(<ButtonCollapsible size="sm" ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(hasModuleClass(button, 'sm')).toBe(true);
  });

  it('has type button by default', () => {
    render(<ButtonCollapsible ariaLabel="Toggle" />);
    const button = screen.getByRole('button', { name: 'Toggle' });
    expect(button).toHaveAttribute('type', 'button');
  });
});
