import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ButtonPlus } from './ButtonPlus';

describe('ButtonPlus', () => {
  it('renders with default props', () => {
    render(<ButtonPlus onClick={() => {}} />);
    const button = screen.getByRole('button', { name: /add/i });
    expect(button).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<ButtonPlus onClick={handleClick} />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<ButtonPlus onClick={handleClick} disabled />);
    
    const button = screen.getByRole('button');
    fireEvent.click(button);
    
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders with custom title', () => {
    render(<ButtonPlus onClick={() => {}} title="Create new item" />);
    const button = screen.getByRole('button', { name: /create new item/i });
    expect(button).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<ButtonPlus onClick={() => {}} className="custom-class" />);
    const button = screen.getByRole('button');
    expect(button).toHaveClass('custom-class');
  });

  it('renders disabled state', () => {
    render(<ButtonPlus onClick={() => {}} disabled />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
  });
});
