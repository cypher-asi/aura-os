import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonWindow } from './ButtonWindow';

describe('ButtonWindow', () => {
  it('renders minimize button', () => {
    render(<ButtonWindow action="minimize" />);
    expect(screen.getByRole('button', { name: 'minimize' })).toBeInTheDocument();
  });

  it('renders maximize button', () => {
    render(<ButtonWindow action="maximize" />);
    expect(screen.getByRole('button', { name: 'maximize' })).toBeInTheDocument();
  });

  it('renders close button', () => {
    render(<ButtonWindow action="close" />);
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<ButtonWindow action="close" onClick={handleClick} />);
    const button = screen.getByRole('button', { name: 'close' });

    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('can be disabled', () => {
    render(<ButtonWindow action="close" disabled />);
    const button = screen.getByRole('button', { name: 'close' });
    expect(button).toBeDisabled();
  });

  it('applies custom className', () => {
    render(<ButtonWindow action="minimize" className="custom-class" />);
    const button = screen.getByRole('button', { name: 'minimize' });
    expect(button.className).toContain('custom-class');
  });
});
