import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Search } from './Search';

describe('Search', () => {
  it('renders with placeholder', () => {
    render(<Search placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('renders as search input type', () => {
    render(<Search placeholder="Search..." />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toHaveAttribute('type', 'search');
  });

  it('handles value changes', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Search placeholder="Search..." onChange={handleChange} />);

    const input = screen.getByPlaceholderText('Search...');
    await user.type(input, 'test');

    expect(handleChange).toHaveBeenCalled();
  });

  it('shows clear button when showClear is true and has value', () => {
    render(
      <Search
        placeholder="Search..."
        value="test"
        showClear
        onClear={() => {}}
      />
    );

    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('hides clear button when value is empty', () => {
    render(
      <Search
        placeholder="Search..."
        value=""
        showClear
        onClear={() => {}}
      />
    );

    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('calls onClear when clear button is clicked', async () => {
    const user = userEvent.setup();
    const handleClear = vi.fn();
    render(
      <Search
        placeholder="Search..."
        value="test"
        showClear
        onClear={handleClear}
      />
    );

    const clearButton = screen.getByRole('button', { name: 'Clear search' });
    await user.click(clearButton);

    expect(handleClear).toHaveBeenCalledTimes(1);
  });

  it('calls onClear when Escape is pressed with value', () => {
    const handleClear = vi.fn();
    render(
      <Search
        placeholder="Search..."
        value="test"
        showClear
        onClear={handleClear}
      />
    );

    const input = screen.getByPlaceholderText('Search...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(handleClear).toHaveBeenCalledTimes(1);
  });

  it('does not call onClear when Escape is pressed without value', () => {
    const handleClear = vi.fn();
    render(
      <Search
        placeholder="Search..."
        value=""
        showClear
        onClear={handleClear}
      />
    );

    const input = screen.getByPlaceholderText('Search...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(handleClear).not.toHaveBeenCalled();
  });

  it('renders with small size', () => {
    const { container } = render(<Search size="sm" placeholder="Search..." />);
    expect(container.querySelector('.sm')).toBeInTheDocument();
  });

  it('has accessible label from placeholder', () => {
    render(<Search placeholder="Search items..." />);
    const input = screen.getByPlaceholderText('Search items...');
    expect(input).toHaveAttribute('aria-label', 'Search items...');
  });

  it('uses provided aria-label over placeholder', () => {
    render(<Search placeholder="Search..." aria-label="Filter results" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toHaveAttribute('aria-label', 'Filter results');
  });

  it('forwards ref to input element', () => {
    const ref = vi.fn();
    render(<Search ref={ref} placeholder="Search..." />);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
  });

  it('applies custom className to wrapper', () => {
    const { container } = render(
      <Search placeholder="Search..." className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('renders with custom icon', () => {
    render(
      <Search
        placeholder="Search..."
        icon={<span data-testid="custom-icon">🔎</span>}
      />
    );
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
  });
});
