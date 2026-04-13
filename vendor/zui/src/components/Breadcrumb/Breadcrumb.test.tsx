import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Breadcrumb } from './Breadcrumb';

describe('Breadcrumb', () => {
  const mockItems = [
    { id: 'root', label: 'Home' },
    { id: 'settings', label: 'Settings' },
    { id: 'account', label: 'Account' },
  ];

  it('renders all items', () => {
    render(<Breadcrumb items={mockItems} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Account')).toBeInTheDocument();
  });

  it('renders nothing when items array is empty', () => {
    const { container } = render(<Breadcrumb items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders last item as current (non-clickable)', () => {
    render(<Breadcrumb items={mockItems} onNavigate={vi.fn()} />);
    const currentItem = screen.getByText('Account');
    expect(currentItem).toHaveAttribute('aria-current', 'page');
    expect(currentItem.tagName).toBe('SPAN');
  });

  it('renders non-last items as clickable buttons when onNavigate provided', () => {
    render(<Breadcrumb items={mockItems} onNavigate={vi.fn()} />);
    const homeButton = screen.getByRole('button', { name: 'Home' });
    const settingsButton = screen.getByRole('button', { name: 'Settings' });
    expect(homeButton).toBeInTheDocument();
    expect(settingsButton).toBeInTheDocument();
  });

  it('calls onNavigate with correct id and index when clicked', async () => {
    const user = userEvent.setup();
    const handleNavigate = vi.fn();
    render(<Breadcrumb items={mockItems} onNavigate={handleNavigate} />);

    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(handleNavigate).toHaveBeenCalledWith('root', 0);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(handleNavigate).toHaveBeenCalledWith('settings', 1);
  });

  it('renders default separator between items', () => {
    render(<Breadcrumb items={mockItems} />);
    const separators = screen.getAllByText('/');
    expect(separators).toHaveLength(2); // n-1 separators for n items
  });

  it('renders custom separator', () => {
    render(<Breadcrumb items={mockItems} separator=">" />);
    const separators = screen.getAllByText('>');
    expect(separators).toHaveLength(2);
  });

  it('applies custom className', () => {
    const { container } = render(
      <Breadcrumb items={mockItems} className="custom-class" />
    );
    expect(container.querySelector('.custom-class')).toBeInTheDocument();
  });

  it('has accessible navigation landmark', () => {
    render(<Breadcrumb items={mockItems} />);
    expect(screen.getByRole('navigation')).toHaveAttribute(
      'aria-label',
      'Breadcrumb'
    );
  });

  it('renders single item without separator', () => {
    render(<Breadcrumb items={[{ id: 'root', label: 'Home' }]} />);
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.queryByText('/')).not.toBeInTheDocument();
  });
});
