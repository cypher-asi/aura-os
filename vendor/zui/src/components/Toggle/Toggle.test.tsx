import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from './Toggle';

describe('Toggle', () => {
  it('renders as a checkbox input', () => {
    render(<Toggle />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });

  it('renders with label on the right by default', () => {
    render(<Toggle label="Enable feature" />);
    expect(screen.getByText('Enable feature')).toBeInTheDocument();
  });

  it('renders with label on the left when specified', () => {
    render(<Toggle label="Enable" labelPosition="left" />);
    const label = screen.getByText('Enable');
    expect(label).toBeInTheDocument();
  });

  it('can be checked and unchecked', () => {
    render(<Toggle />);
    const checkbox = screen.getByRole('checkbox');

    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('calls onChange when toggled', () => {
    const handleChange = vi.fn();
    render(<Toggle onChange={handleChange} />);
    const checkbox = screen.getByRole('checkbox');

    fireEvent.click(checkbox);
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('can be controlled', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    const checkbox = screen.getByRole('checkbox');

    expect(checkbox).toBeChecked();
  });

  it('can be disabled', () => {
    render(<Toggle disabled />);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toBeDisabled();
  });

  it('applies custom className', () => {
    const { container } = render(<Toggle className="custom-class" />);
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });
});
