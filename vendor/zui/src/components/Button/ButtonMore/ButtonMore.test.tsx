import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonMore } from './ButtonMore';
import type { MenuItem } from '../../Menu';

// Helper to check CSS module class names
const hasModuleClass = (element: HTMLElement, className: string) => {
  return Array.from(element.classList).some((cls) => cls.includes(className));
};

const mockItems: MenuItem[] = [
  { id: 'edit', label: 'Edit' },
  { id: 'delete', label: 'Delete' },
];

describe('ButtonMore', () => {
  it('renders a button with more icon', () => {
    render(<ButtonMore items={mockItems} />);
    const button = screen.getByRole('button', { name: 'More actions' });
    expect(button).toBeInTheDocument();
  });

  it('opens menu when clicked', () => {
    render(<ButtonMore items={mockItems} />);
    const button = screen.getByRole('button', { name: 'More actions' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(button);

    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('closes menu when clicked outside', () => {
    render(
      <div>
        <ButtonMore items={mockItems} />
        <div data-testid="outside">Outside</div>
      </div>
    );

    const button = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(button);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('calls onSelect when menu item is clicked', () => {
    const handleSelect = vi.fn();
    render(<ButtonMore items={mockItems} onSelect={handleSelect} />);

    const button = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(button);

    const editItem = screen.getByText('Edit');
    fireEvent.click(editItem);

    expect(handleSelect).toHaveBeenCalledWith('edit');
  });

  it('closes menu after selection', () => {
    const handleSelect = vi.fn();
    render(<ButtonMore items={mockItems} onSelect={handleSelect} />);

    const button = screen.getByRole('button', { name: 'More actions' });
    fireEvent.click(button);

    const editItem = screen.getByText('Edit');
    fireEvent.click(editItem);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('can be disabled', () => {
    render(<ButtonMore items={mockItems} disabled />);
    const button = screen.getByRole('button', { name: 'More actions' });
    expect(button).toBeDisabled();
  });

  it('does not open menu when disabled', () => {
    render(<ButtonMore items={mockItems} disabled />);
    const button = screen.getByRole('button', { name: 'More actions' });

    fireEvent.click(button);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<ButtonMore items={mockItems} className="custom-class" />);
    const container = screen.getByRole('button', { name: 'More actions' }).parentElement;
    expect(container?.className).toContain('custom-class');
  });

  it('applies custom title', () => {
    render(<ButtonMore items={mockItems} title="Custom title" />);
    const button = screen.getByRole('button', { name: 'Custom title' });
    expect(button).toHaveAttribute('title', 'Custom title');
  });

  it('has aria-haspopup attribute', () => {
    render(<ButtonMore items={mockItems} />);
    const button = screen.getByRole('button', { name: 'More actions' });
    expect(button).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('has aria-expanded attribute that reflects open state', () => {
    render(<ButtonMore items={mockItems} />);
    const button = screen.getByRole('button', { name: 'More actions' });

    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('applies active style when menu is open', () => {
    render(<ButtonMore items={mockItems} />);
    const button = screen.getByRole('button', { name: 'More actions' });

    expect(hasModuleClass(button, 'triggerActive')).toBe(false);

    fireEvent.click(button);
    expect(hasModuleClass(button, 'triggerActive')).toBe(true);
  });
});
